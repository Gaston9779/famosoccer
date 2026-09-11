import type { Prisma } from "../../generated/prisma/client";
import { db } from "../db";
import { TransfermarktClient } from "../transfermarkt/client";
import { TransfermarktProvider } from "../transfermarkt/provider";
import { playerUrl } from "../transfermarkt/endpoints";
import type { parseProfile } from "../transfermarkt/parsers/profile";
import type { Performance } from "../transfermarkt/types";
import { currentLeaguePerformance } from "../transfermarkt/parsers/performance";
import { ProviderError } from "../transfermarkt/errors";
import { scoringInputs } from "../scoring";
import { calculateAndPersistPlayerOpportunity } from "../intelligence/persistence";
import { finishRun, withSyncLock } from "./runs";
import { describeError, importLog, type ImportStage } from "../import-diagnostics";
export type Counts = {
  playersCreated: number;
  playersUpdated: number;
  clubsCreated: number;
  clubsUpdated: number;
  performanceRowsCreated: number;
  performanceRowsUpdated: number;
};
export const emptyCounts = (): Counts => ({
  playersCreated: 0,
  playersUpdated: 0,
  clubsCreated: 0,
  clubsUpdated: 0,
  performanceRowsCreated: 0,
  performanceRowsUpdated: 0,
});

export type PlayerScope = "UZBEKISTAN" | "ITA" | "OTHER" | "ALL";
export type ManualImportOperation = "IMPORTED" | "UPDATED";

export function playerScopeFromQuery(value: string | null | undefined): PlayerScope {
  if (value === "other") return "OTHER";
  if (value === "ita") return "ITA";
  if (value === "all") return "ALL";
  return "UZBEKISTAN";
}

export function playerScopeWhere(scope: PlayerScope): Prisma.PlayerWhereInput {
  if (scope === "ALL") return {};
  if (scope === "UZBEKISTAN") {
    return {
      careerStatus: { notIn: ["FREE_AGENT", "RETIRED"] },
      club: { is: { competition: { is: { tmCompetitionId: "UZ1" } } } },
    };
  }
  if (scope === "ITA") return { pools: { some: { poolKey: "ITA" } } };
  return {
    AND: [{ pools: { none: { poolKey: "ITA" } } }, { OR: [
      { careerStatus: { in: ["FREE_AGENT", "RETIRED"] } },
      { NOT: { club: { is: { competition: { is: { tmCompetitionId: "UZ1" } } } } } },
    ] }],
  };
}

export function isPerformanceUnavailable(error: unknown): error is ProviderError {
  return error instanceof ProviderError && error.code === "HTTP" && error.status === 404;
}
/** Canonical Player identity is always the unique Transfermarkt player ID. */
export async function resolveOrCreatePlayer<T extends Prisma.PlayerCreateInput>(data: T) {
  return db.player.upsert({
    where: { tmPlayerId: data.tmPlayerId },
    create: data,
    update: data,
  });
}
const tracked = (p: {
  contractExpires: Date | null;
  representationStatus: string;
  agencyName: string | null;
  marketValueEur: number | null;
  clubId: string | null;
}) =>
  JSON.stringify([
    p.contractExpires?.toISOString() ?? null,
    p.representationStatus,
    p.agencyName,
    p.marketValueEur,
    p.clubId,
  ]);
export async function saveProfile(
  profile: ReturnType<typeof parseProfile>,
  counts = emptyCounts(),
  manual = false,
) {
  return db.$transaction(async (tx) => {
    const { currentClub, ...data } = profile;
    const existing = await tx.player.findUnique({
      where: { tmPlayerId: data.tmPlayerId },
    });
    let clubId = existing?.clubId ?? null;
    if (currentClub?.name) {
      const previous = await tx.club.findUnique({
        where: { tmClubId: currentClub.tmClubId },
      });
      const club = await tx.club.upsert({
        where: { tmClubId: currentClub.tmClubId },
        create: {
          tmClubId: currentClub.tmClubId,
          name: currentClub.name,
          tmUrl: currentClub.tmUrl,
        },
        update: { name: currentClub.name, tmUrl: currentClub.tmUrl },
      });
      counts[previous ? "clubsUpdated" : "clubsCreated"]++;
      if (clubId && clubId !== club.id && !manual)
        console.log(
          JSON.stringify({
            event: "club.disagreement",
            player: data.tmPlayerId,
            rosterClubId: clubId,
            profileClubId: club.id,
            resolution: "preserve roster relation for review",
          }),
        );
      else clubId = club.id;
    }
    // A manual profile import is the current-club authority. It must be able
    // to move a player between UZ1, other leagues, and free agency.
    if (manual && !currentClub) clubId = null;
    const keepKnown = <T>(incoming: T | null, known: T | null) => incoming ?? known;
    const keepText = (incoming: string | null, known: string | null) =>
      incoming?.trim() ? incoming : known;
    const keepJson = (incoming: string | null, known: string) =>
      incoming?.trim() && incoming.trim() !== "[]" ? incoming : known;
    const preserved = existing
      ? {
          ...data,
          portraitUrl: keepText(data.portraitUrl, existing.portraitUrl),
          birthDate: keepKnown(data.birthDate, existing.birthDate),
          age: keepKnown(data.age, existing.age),
          birthPlace: keepText(data.birthPlace, existing.birthPlace),
          nationalities: keepJson(data.nationalities, existing.nationalities),
          heightCm: keepKnown(data.heightCm, existing.heightCm),
          preferredFoot: data.preferredFoot === "UNKNOWN" ? existing.preferredFoot : data.preferredFoot,
          mainPosition: keepText(data.mainPosition, existing.mainPosition),
          positionGroup: keepText(data.positionGroup, existing.positionGroup),
          secondaryPositions: keepText(data.secondaryPositions, existing.secondaryPositions),
          shirtNumber: keepText(data.shirtNumber, existing.shirtNumber),
          joinedDate: keepKnown(data.joinedDate, existing.joinedDate),
          contractExpires: keepKnown(data.contractExpires, existing.contractExpires),
          contractOption: keepText(data.contractOption, existing.contractOption),
          agentRaw: keepText(data.agentRaw, existing.agentRaw),
          agencyName: keepText(data.agencyName, existing.agencyName),
          representationStatus:
            data.representationStatus === "UNKNOWN" ? existing.representationStatus : data.representationStatus,
          marketValueRaw: keepText(data.marketValueRaw, existing.marketValueRaw),
          marketValueEur: keepKnown(data.marketValueEur, existing.marketValueEur),
          // An incomplete profile must not downgrade a known active/free-agent/retired state.
          careerStatus: data.careerStatus === "UNKNOWN" ? existing.careerStatus : data.careerStatus,
          confirmedFreeAgent:
            data.careerStatus === "UNKNOWN" ? existing.confirmedFreeAgent : data.confirmedFreeAgent,
        }
      : data;
    const player = await tx.player.upsert({
      where: { tmPlayerId: data.tmPlayerId },
      create: {
        ...preserved,
        clubId,
        manuallyAdded: manual,
        profileLastSyncedAt: new Date(),
      },
      update: {
        ...preserved,
        clubId,
        // A current club ends a previously confirmed free-agent state.
        careerStatus: preserved.careerStatus,
        confirmedFreeAgent: preserved.careerStatus === "FREE_AGENT",
        ...(manual ? { manuallyAdded: true } : {}),
        profileLastSyncedAt: new Date(),
      },
    });
    counts[existing ? "playersUpdated" : "playersCreated"]++;
    if (!existing || tracked(existing) !== tracked(player))
      await tx.playerSnapshot.create({
        data: {
          playerId: player.id,
          contractExpires: player.contractExpires,
          representationStatus: player.representationStatus,
          agencyName: player.agencyName,
          marketValueEur: player.marketValueEur,
          clubId: player.clubId,
        },
      });
    return player;
  });
}
export async function savePerformance(
  playerId: string,
  rows: Performance[],
  counts = emptyCounts(),
) {
  // Fields where an incoming null means "not reported this time" and must never
  // clobber a previously stored value. 0 is real data and does overwrite.
  const preservable = [
    "possibleGames", "gamesPlayed", "goals", "assists", "yellowCards",
    "secondYellowCards", "redCards", "startElevenPercent", "minutesPlayedPercent",
    "minutesPlayed", "competitionCode",
  ] as const;
  // A TMAPI response can contain dozens of historical competition/season rows.
  // Fetch existing rows once, then use one batched transaction. The old per-row
  // read + upsert loop held a remote Postgres interactive transaction long enough
  // to expire on large, valid responses.
  const existing = await db.playerPerformance.findMany({
    where: {
      playerId,
      OR: rows.map((row) => ({ season: row.season, competitionKey: row.competitionKey })),
    },
  });
  const existingByKey = new Map(existing.map((row) => [`${row.season}|${row.competitionKey}`, row]));
  const now = new Date();
  const creates: Performance[] = [];
  const updates: { id: string; row: Performance }[] = [];
  for (const incoming of rows) {
    const previous = existingByKey.get(`${incoming.season}|${incoming.competitionKey}`);
    const merged: Performance = { ...incoming };
    if (previous)
      for (const field of preservable)
        if (merged[field] == null && previous[field] != null)
          (merged[field] as unknown) = previous[field];
    if (previous) updates.push({ id: previous.id, row: merged });
    else creates.push(merged);
  }
  counts.performanceRowsCreated += creates.length;
  counts.performanceRowsUpdated += updates.length;
  const writes = [
    ...(creates.length ? [db.playerPerformance.createMany({ data: creates.map((row) => ({ ...row, playerId, provider: "TRANSFERMARKT" as const, sourceUpdatedAt: now })) })] : []),
    ...updates.map(({ id, row }) => db.playerPerformance.update({ where: { id }, data: { ...row, provider: "TRANSFERMARKT", sourceUpdatedAt: now } })),
    db.player.update({ where: { id: playerId }, data: { performanceLastSyncedAt: now } }),
  ];
  const current = currentLeaguePerformance(rows);
  if (current)
    writes.push(db.competition.updateMany({ where: { tmCompetitionId: "UZ1" }, data: { season: current.season } }));
  await db.$transaction(writes, { timeout: 60_000 });
}
/** Records a successful performance check with no available row (for example HTTP 404). */
export async function markPerformanceChecked(playerId: string) {
  await db.player.update({
    where: { id: playerId },
    data: { performanceLastSyncedAt: new Date() },
  });
}
export async function importPlayerFromTransfermarktUrl(url: string) {
  const parsed = playerUrl(url);
  const importStartedAt = Date.now();
  const since = () => Date.now() - importStartedAt;
  importLog("IMPORT_START", { tmPlayerId: parsed.id });
  let stage: ImportStage = "IMPORT_START";
  return withSyncLock(async () => {
    const run = await db.syncRun.create({ data: { type: "MANUAL" } });
    const counts = emptyCounts();
    const provider = new TransfermarktProvider(
      new TransfermarktClient(run.id, 10, undefined, undefined, { noRetries: true }),
    );
    try {
      stage = "TM_FETCH_START";
      // TransfermarktClient emits its own TM_FETCH_START / TM_FETCH_RESULT lines.
      const profile = await provider.fetchPlayerProfile(parsed.id, parsed.url);
      stage = "PROFILE_PARSE_RESULT";
      importLog("PROFILE_PARSE_RESULT", {
        runId: run.id,
        tmPlayerId: parsed.id,
        name: profile.name,
        hasCurrentClub: !!profile.currentClub?.name,
        durationMs: since(),
      });

      stage = "DB_WRITE_START";
      importLog("DB_WRITE_START", { runId: run.id, durationMs: since() });
      const player = await saveProfile(profile, counts, true);
      const operation: ManualImportOperation = counts.playersCreated === 1 ? "IMPORTED" : "UPDATED";
      let performanceUnavailable = false;
      try {
        await savePerformance(
          player.id,
          await provider.performance(parsed.id),
          counts,
        );
      } catch (error) {
        if (!isPerformanceUnavailable(error)) throw error;
        performanceUnavailable = true;
      }
      // The existing scorer owns history/current-row semantics. Individual
      // opportunity remains valid outside the UZ1 intelligence universe.
      await calculateAndPersistPlayerOpportunity(player.id);
      const complete = await db.player.findUniqueOrThrow({
        where: { id: player.id },
        include: {
          club: true,
          performances: true,
          opportunityHistory: { where: { isCurrent: true }, take: 1 },
        },
      });
      stage = "DB_WRITE_RESULT";
      importLog("DB_WRITE_RESULT", {
        runId: run.id,
        playerId: player.id,
        operation,
        performanceUnavailable,
        durationMs: since(),
      });
      const enriched = { ...complete, ...scoringInputs(complete), syncRunId: run.id };
      if (performanceUnavailable) {
        await finishRun(
          run.id,
          new ProviderError("HTTP", "Performance data unavailable (HTTP 404).", 404),
          { counts },
        );
        importLog("IMPORT_COMPLETE", { runId: run.id, playerId: player.id, status: "PARTIAL", operation, durationMs: since() });
        return {
          status: "PARTIAL" as const,
          operation,
          player: enriched,
          warning: "Performance data is currently unavailable.",
        };
      }
      await finishRun(run.id, undefined, { counts });
      importLog("IMPORT_COMPLETE", { runId: run.id, playerId: player.id, status: operation, operation, durationMs: since() });
      return { status: operation, player: enriched };
    } catch (error) {
      importLog("IMPORT_ERROR", { runId: run.id, stage, durationMs: since(), ...describeError(error) });
      await finishRun(run.id, error, { counts });
      throw error;
    }
  }).catch((error) => {
    // Failures before the run row exists (sync lock, read-only filesystem) still get one line.
    if (stage === "IMPORT_START")
      importLog("IMPORT_ERROR", { stage, durationMs: since(), ...describeError(error) });
    throw error;
  });
}
