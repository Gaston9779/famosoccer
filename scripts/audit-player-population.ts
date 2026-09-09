import "dotenv/config";
import { db } from "../src/lib/db";
import { nameSimilarity, normalizePersonName } from "../src/lib/identity/name-normalization";
import { hasValidTmPlayerId } from "../src/lib/services/player-enrichment";

type PlayerRow = Awaited<ReturnType<typeof loadPlayers>>[number];

async function loadPlayers() {
  return db.player.findMany({
    select: {
      id: true,
      name: true,
      tmPlayerId: true,
      tmUrl: true,
      clubId: true,
      manuallyAdded: true,
      confirmedFreeAgent: true,
      birthDate: true,
      age: true,
      nationalities: true,
      mainPosition: true,
      positionGroup: true,
      club: {
        select: {
          name: true,
          tmClubId: true,
          competition: {
            select: { tmCompetitionId: true, name: true },
          },
        },
      },
    },
    orderBy: { id: "asc" },
  });
}

const isUz1 = (player: PlayerRow) =>
  player.club?.competition?.tmCompetitionId === "UZ1";
const isOther = (player: PlayerRow) => !isUz1(player);
const hasEmptyTmPlayerId = (player: PlayerRow) => !player.tmPlayerId?.trim();

const count = (players: PlayerRow[], predicate: (player: PlayerRow) => boolean) =>
  players.filter(predicate).length;

function printSection(title: string, values: Record<string, number | string>) {
  console.log(`\n${title}`);
  for (const [label, value] of Object.entries(values))
    console.log(`${label}: ${value}`);
}

function competitionDistribution(players: PlayerRow[]) {
  const rows = new Map<string, { id: string | null; name: string; count: number }>();
  for (const player of players) {
    const competition = player.club?.competition;
    const key = competition?.tmCompetitionId ?? "null";
    const row = rows.get(key) ?? {
      id: competition?.tmCompetitionId ?? null,
      name: competition?.name ?? "No mapped competition",
      count: 0,
    };
    row.count++;
    rows.set(key, row);
  }
  return [...rows.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

function parseNationalities(value: string) {
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed))
      return parsed.filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim().toLowerCase())
        .filter(Boolean);
  } catch {
    // Older records can contain a raw string rather than JSON.
  }
  return value.trim() ? [value.trim().toLowerCase()] : [];
}

const isUzbek = (player: PlayerRow) =>
  parseNationalities(player.nationalities).some((nationality) => /uzbek/.test(nationality));
const position = (player: PlayerRow) => player.mainPosition ?? player.positionGroup ?? null;

type IdentityGroup = "A. likely current Uzbekistan players" | "B. likely former Uzbekistan players" | "C. free agents / without club" | "D. foreign players" | "E. insufficient identity data";

function classifyIdentity(player: PlayerRow): IdentityGroup {
  if (isUz1(player)) return "A. likely current Uzbekistan players";
  // Seed URLs are evidence of historic UZ1 provenance, not an identity match.
  if (isUzbek(player) || /^seed:\/\/uz1\//i.test(player.tmUrl))
    return "B. likely former Uzbekistan players";
  if (player.confirmedFreeAgent || player.clubId === null)
    return "C. free agents / without club";
  if (player.club?.competition || parseNationalities(player.nationalities).length)
    return "D. foreign players";
  return "E. insufficient identity data";
}

function invalidIdReason(player: PlayerRow) {
  const id = player.tmPlayerId;
  if (id == null) return "missing";
  if (!id.trim()) return "empty";
  if (/^(seed|internal|local|manual):/i.test(id)) return "synthetic/internal ID";
  if (/\s/.test(id) || /[^\w:-]/.test(id)) return "malformed";
  if (!/^\d+$/.test(id)) return "wrong format";
  return "other";
}

function identityRows(players: PlayerRow[]) {
  return players.map((player) => ({
    playerId: player.id,
    name: player.name,
    tmPlayerId: player.tmPlayerId,
    tmUrl: player.tmUrl,
    birthDate: player.birthDate?.toISOString().slice(0, 10) ?? null,
    age: player.age,
    nationalities: player.nationalities,
    position: position(player),
    club: player.club?.name ?? null,
    tmClubId: player.club?.tmClubId ?? null,
    competition: player.club?.competition?.name ?? null,
    manuallyAdded: player.manuallyAdded,
  }));
}

function fuzzyCandidates(players: PlayerRow[]) {
  const candidates: Array<{
    left: PlayerRow;
    right: PlayerRow;
    similarity: number;
    birthDateMatch: boolean;
    nationalityMatch: boolean;
    positionMatch: boolean;
    clubMatch: boolean;
    confidence: "HIGH" | "MEDIUM" | "LOW";
    score: number;
    why: string;
  }> = [];
  for (let i = 0; i < players.length; i++) {
    for (let j = i + 1; j < players.length; j++) {
      const left = players[i];
      const right = players[j];
      const similarity = nameSimilarity(left.name, right.name);
      const birthDateMatch = left.birthDate !== null && right.birthDate !== null && left.birthDate.getTime() === right.birthDate.getTime();
      const nationalityMatch = parseNationalities(left.nationalities).some((item) => parseNationalities(right.nationalities).includes(item));
      const positionMatch = position(left) !== null && position(left) === position(right);
      const clubMatch = left.club?.tmClubId !== undefined && left.club?.tmClubId === right.club?.tmClubId;
      // Names need a meaningful similarity unless an exact DOB and at least one
      // corroborating attribute provide a strong candidate.
      if (similarity < 0.78 && !(birthDateMatch && (nationalityMatch || positionMatch || clubMatch))) continue;
      const score = Math.round(
        Math.min(similarity, 1) * 45 +
          (birthDateMatch ? 35 : 0) +
          (clubMatch ? 12 : 0) +
          (positionMatch ? 5 : 0) +
          (nationalityMatch ? 3 : 0),
      );
      if (score < 40) continue;
      const confidence = score >= 75 ? "HIGH" : score >= 55 ? "MEDIUM" : "LOW";
      const why = [
        `name similarity ${(similarity * 100).toFixed(1)}%`,
        birthDateMatch ? "birth date match" : null,
        clubMatch ? "club match" : null,
        positionMatch ? "position match" : null,
        nationalityMatch ? "nationality match" : null,
      ].filter(Boolean).join("; ");
      candidates.push({ left, right, similarity, birthDateMatch, nationalityMatch, positionMatch, clubMatch, confidence, score, why });
    }
  }
  return candidates.sort((a, b) => b.score - a.score || a.left.name.localeCompare(b.left.name));
}

type FuzzyCandidate = ReturnType<typeof fuzzyCandidates>[number];
type CandidateClass = "A. MATCHES EXISTING CANONICAL PLAYER" | "B. MATCHES EXTERNAL PLAYER NOT PRESENT IN DB" | "C. AMBIGUOUS / NO SAFE MATCH";

const isSyntheticIdentity = (player: PlayerRow) =>
  invalidIdReason(player) === "synthetic/internal ID";

function classifyCandidate(candidate: FuzzyCandidate): CandidateClass {
  const seedCount = Number(isSyntheticIdentity(candidate.left)) + Number(isSyntheticIdentity(candidate.right));
  const validCount = Number(hasValidTmPlayerId(candidate.left.tmPlayerId)) + Number(hasValidTmPlayerId(candidate.right.tmPlayerId));
  // Group A is the only classification that the local database can prove:
  // one synthetic seed row and one distinct canonical numeric TM identity.
  if (seedCount === 1 && validCount === 1)
    return "A. MATCHES EXISTING CANONICAL PLAYER";
  // No external player identity or TM ID is available in this read-only data
  // set, so B cannot be asserted without an external authoritative source.
  return "C. AMBIGUOUS / NO SAFE MATCH";
}

function candidateRow(candidate: FuzzyCandidate) {
  const seed = isSyntheticIdentity(candidate.left) ? candidate.left : candidate.right;
  const canonical = seed === candidate.left ? candidate.right : candidate.left;
  return {
    seedPlayerId: seed.id,
    seedName: seed.name,
    seedTmPlayerId: seed.tmPlayerId,
    canonicalPlayerId: hasValidTmPlayerId(canonical.tmPlayerId) ? canonical.id : null,
    canonicalName: hasValidTmPlayerId(canonical.tmPlayerId) ? canonical.name : null,
    canonicalTmPlayerId: hasValidTmPlayerId(canonical.tmPlayerId) ? canonical.tmPlayerId : null,
    birthDateMatch: candidate.birthDateMatch,
    clubMatch: candidate.clubMatch,
    positionMatch: candidate.positionMatch,
    nameSimilarity: `${(candidate.similarity * 100).toFixed(1)}%`,
    confidence: candidate.confidence,
    score: candidate.score,
    why: candidate.why,
  };
}

function ambiguousCandidateRow(candidate: FuzzyCandidate) {
  return {
    leftPlayerId: candidate.left.id,
    leftName: candidate.left.name,
    leftTmPlayerId: candidate.left.tmPlayerId,
    rightPlayerId: candidate.right.id,
    rightName: candidate.right.name,
    rightTmPlayerId: candidate.right.tmPlayerId,
    birthDateMatch: candidate.birthDateMatch,
    clubMatch: candidate.clubMatch,
    positionMatch: candidate.positionMatch,
    nameSimilarity: `${(candidate.similarity * 100).toFixed(1)}%`,
    confidence: candidate.confidence,
    score: candidate.score,
    why: candidate.why,
  };
}

async function main() {
  const players = await loadPlayers();
  const duplicateIds = [...players.reduce((groups, player) => {
    const id = player.tmPlayerId.trim();
    if (id) groups.set(id, [...(groups.get(id) ?? []), player]);
    return groups;
  }, new Map<string, PlayerRow[]>()).entries()].filter(([, group]) => group.length > 1);
  const invalid = players.filter(
    (player) => !hasEmptyTmPlayerId(player) && !hasValidTmPlayerId(player.tmPlayerId),
  );
  const empty = players.filter(hasEmptyTmPlayerId);

  printSection("BASIC COUNTS", {
    "TOTAL PLAYERS": players.length,
    "UZ1 CURRENT": count(players, isUz1),
    OTHER: count(players, isOther),
    "MANUALLY ADDED": count(players, (player) => player.manuallyAdded),
    "WITHOUT CLUB": count(players, (player) => player.clubId === null),
    "CONFIRMED FREE AGENTS": count(players, (player) => player.confirmedFreeAgent),
  });

  printSection("CROSS COUNTS", {
    "UZ1 + manuallyAdded=true": count(players, (player) => isUz1(player) && player.manuallyAdded),
    "UZ1 + manuallyAdded=false": count(players, (player) => isUz1(player) && !player.manuallyAdded),
    "OTHER + manuallyAdded=true": count(players, (player) => isOther(player) && player.manuallyAdded),
    "OTHER + manuallyAdded=false": count(players, (player) => isOther(player) && !player.manuallyAdded),
    "clubId null + manuallyAdded=true": count(players, (player) => player.clubId === null && player.manuallyAdded),
    "clubId null + manuallyAdded=false": count(players, (player) => player.clubId === null && !player.manuallyAdded),
    "competition null + clubId not null": count(players, (player) => player.clubId !== null && player.club?.competition === null),
  });

  printSection("TM PLAYER ID AUDIT", {
    "Validation rule used by enrich:players": "/^\\d+$/ (one or more digits; empty values are invalid)",
    "Valid tmPlayerId": count(players, (player) => hasValidTmPlayerId(player.tmPlayerId)),
    "Invalid tmPlayerId": invalid.length,
    "Empty/null tmPlayerId": empty.length,
    "Duplicate tmPlayerId": duplicateIds.length,
  });
  if (invalid.length) {
    console.log("\nINVALID TM PLAYER IDS (first 30)");
    console.table(invalid.slice(0, 30).map((player) => ({
      playerId: player.id,
      name: player.name,
      tmPlayerId: player.tmPlayerId,
      tmUrl: player.tmUrl,
      clubName: player.club?.name ?? null,
      competitionId: player.club?.competition?.tmCompetitionId ?? null,
      competitionName: player.club?.competition?.name ?? null,
      manuallyAdded: player.manuallyAdded,
    })));
  }
  if (duplicateIds.length) {
    console.log("\nDUPLICATE TM PLAYER IDS");
    console.table(duplicateIds.map(([tmPlayerId, group]) => ({
      tmPlayerId,
      playerIds: group.map((player) => player.id).join(", "),
      names: group.map((player) => player.name).join(", "),
    })));
  }

  const identityAudit = players.filter((player) => !hasValidTmPlayerId(player.tmPlayerId));
  const groups = new Map<IdentityGroup, PlayerRow[]>();
  for (const player of identityAudit) {
    const group = classifyIdentity(player);
    groups.set(group, [...(groups.get(group) ?? []), player]);
  }
  console.log("\nIDENTITY / NAME QUALITY AUDIT");
  for (const group of [
    "A. likely current Uzbekistan players",
    "B. likely former Uzbekistan players",
    "C. free agents / without club",
    "D. foreign players",
    "E. insufficient identity data",
  ] as const) {
    const entries = groups.get(group) ?? [];
    console.log(`\n${group}: ${entries.length}`);
    if (entries.length) console.table(identityRows(entries));
  }

  const invalidReasonCounts = new Map<string, number>();
  for (const player of identityAudit) {
    const reason = invalidIdReason(player);
    invalidReasonCounts.set(reason, (invalidReasonCounts.get(reason) ?? 0) + 1);
  }
  console.log("\nINVALID TM ID BREAKDOWN");
  console.table([...invalidReasonCounts.entries()].map(([reason, players]) => ({ reason, players })));

  const candidates = fuzzyCandidates(players);
  console.log("\nFUZZY IDENTITY CANDIDATES (analysis only; never merge automatically)");
  if (candidates.length) {
    console.table(candidates.map((candidate) => ({
      left: candidate.left.name,
      right: candidate.right.name,
      leftPlayerId: candidate.left.id,
      rightPlayerId: candidate.right.id,
      confidence: candidate.confidence,
      score: candidate.score,
      normalizedLeft: normalizePersonName(candidate.left.name),
      normalizedRight: normalizePersonName(candidate.right.name),
      why: candidate.why,
    })));
  } else console.log("No candidates met the conservative multi-signal threshold.");

  const candidateGroups = new Map<CandidateClass, FuzzyCandidate[]>();
  for (const candidate of candidates) {
    const group = classifyCandidate(candidate);
    candidateGroups.set(group, [...(candidateGroups.get(group) ?? []), candidate]);
  }
  console.log("\nFUZZY CANDIDATE CLASSIFICATION");
  for (const group of [
    "A. MATCHES EXISTING CANONICAL PLAYER",
    "B. MATCHES EXTERNAL PLAYER NOT PRESENT IN DB",
    "C. AMBIGUOUS / NO SAFE MATCH",
  ] as const) {
    const entries = candidateGroups.get(group) ?? [];
    console.log(`\n${group}: ${entries.length}`);
    if (entries.length) {
      if (group === "A. MATCHES EXISTING CANONICAL PLAYER")
        console.table(entries.map(candidateRow));
      else console.table(entries.map(ambiguousCandidateRow));
    }
    if (group === "B. MATCHES EXTERNAL PLAYER NOT PRESENT IN DB" && !entries.length)
      console.log("No externally sourced tmPlayerId is available in the local database; this audit cannot assert external identities without a trusted external source.");
  }

  printSection("UZBEKISTAN SCOUTING RELEVANCE", {
    "Current Uzbekistan Super League players": count(players, isUz1),
    "Likely former Uzbekistan players": groups.get("B. likely former Uzbekistan players")?.length ?? 0,
    "Free agents / without club": groups.get("C. free agents / without club")?.length ?? 0,
    "Manual scouting targets": count(players, (player) => player.manuallyAdded),
  });

  console.log("\nCOMPETITION DISTRIBUTION");
  console.table(competitionDistribution(players).map((competition) => ({
    competitionId: competition.id ?? "null",
    competitionName: competition.name,
    players: competition.count,
  })));
}

try {
  await main();
} finally {
  await db.$disconnect();
}
