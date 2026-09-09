import { createHash } from "node:crypto";
import { db } from "../db";
import { calculatePlayerOpportunity } from "../scoring/playerOpportunity";
import { calculateClubNeed } from "../scoring/clubNeed";
import { normalizeRole } from "../scoring/roles";
import { scoringConfig, type KnownRole } from "../scoring/config";
import { generateSnapshotEvents, scoreChangeEvent } from "./events";
import type { IntelligencePlayer } from "../scoring/types";
export async function loadScoringData(currentUz1Only = false) {
  const [players, clubs, competition] = await Promise.all([
    db.player.findMany({
      ...(currentUz1Only
        ? { where: { club: { competition: { tmCompetitionId: "UZ1" } } } }
        : {}),
      include: { performances: true },
      orderBy: { id: "asc" },
    }),
    db.club.findMany({
      where: { competition: { tmCompetitionId: "UZ1" } },
      orderBy: { id: "asc" },
    }),
    db.competition.findUnique({ where: { tmCompetitionId: "UZ1" } }),
  ]);
  return { players, clubs, season: competition?.season ?? null };
}
async function persistPlayer(
  player: IntelligencePlayer,
  season: string | null,
  now: Date,
) {
  const score = calculatePlayerOpportunity(player, season, now);
  return db.$transaction(async (tx) => {
    const previous = await tx.playerOpportunityHistory.findFirst({
      where: { playerId: player.id, isCurrent: true },
      orderBy: [{ calculatedAt: "desc" }, { id: "desc" }],
    });
    await tx.playerOpportunityHistory.updateMany({
      where: { playerId: player.id, isCurrent: true },
      data: { isCurrent: false },
    });
    const { reasons, warnings, confidenceReasons, rawOpportunity, adjustedOpportunity, knownScoreSum, knownMaxScoreSum, ...values } = score;
    const row = await tx.playerOpportunityHistory.create({
      data: {
        ...values,
        playerId: player.id,
        reasonsJson: JSON.stringify({ reasons, rawOpportunity, adjustedOpportunity, knownScoreSum, knownMaxScoreSum }),
        warningsJson: JSON.stringify(warnings),
        confidenceReasonsJson: JSON.stringify(confidenceReasons),
        algorithmVersion: scoringConfig.algorithmVersion,
        calculatedAt: now,
      },
    });
    const event = row.total === null ? null : scoreChangeEvent(
      "OPPORTUNITY_SCORE",
      previous?.total ?? null,
      row.total,
    );
    if (event)
      await tx.playerEvent.create({
        data: {
          ...event,
          playerId: player.id,
          dedupeKey: `score:${row.id}`,
          metadata: JSON.stringify({
            previousHistoryId: previous!.id,
            historyId: row.id,
          }),
        },
      });
    return {
      playerId: player.id,
      name: player.name,
      ...score,
      calculatedAt: now,
    };
  });
}
export async function calculateAndPersistPlayerOpportunity(
  playerId: string,
  now = new Date(),
) {
  const player = await db.player.findUniqueOrThrow({
    where: { id: playerId },
    include: { performances: true },
  });
  const competition = await db.competition.findUnique({
    where: { tmCompetitionId: "UZ1" },
  });
  await generateSnapshotEvents(playerId);
  return persistPlayer(player, competition?.season ?? null, now);
}
export async function recalculateAllPlayerOpportunities(
  now = new Date(),
  currentUz1Only = false,
  includeSnapshotEvents = true,
  concurrency = 1,
  playerIds?: ReadonlySet<string>,
) {
  const data = await loadScoringData(currentUz1Only);
  const targetPlayers = playerIds
    ? data.players.filter((player) => playerIds.has(player.id))
    : data.players;
  if (includeSnapshotEvents) {
    if (currentUz1Only)
      for (const player of targetPlayers) await generateSnapshotEvents(player.id);
    else await generateSnapshotEvents();
  }
  const results: Awaited<ReturnType<typeof persistPlayer>>[] = [];
  let next = 0;
  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (next < targetPlayers.length) {
      const player = targetPlayers[next++];
      results.push(await persistPlayer(player, data.season, now));
    }
  });
  await Promise.all(workers);
  return results;
}
export async function recalculateAllClubNeeds(now = new Date()) {
  const data = await loadScoringData();
  const results = [];
  for (const club of data.clubs)
    for (const role of Object.keys(scoringConfig.idealDepth) as KnownRole[]) {
      const score = calculateClubNeed(
        club.id,
        role,
        data.players,
        now,
        club.lastSyncedAt,
      );
      const composition = data.players
        .filter(
          (p) =>
            p.clubId === club.id &&
            (normalizeRole(p.mainPosition) === role ||
              normalizeRole(p.mainPosition) === "UNKNOWN"),
        )
        .map((p) => [p.id, normalizeRole(p.mainPosition)])
        .sort((a, b) => a[0].localeCompare(b[0]));
      const compositionHash = createHash("sha256")
        .update(JSON.stringify([composition, score.available]))
        .digest("hex");
      const row = await db.$transaction(async (tx) => {
        const previous = await tx.clubNeedHistory.findFirst({
          where: { clubId: club.id, role, isCurrent: true },
          orderBy: [{ calculatedAt: "desc" }, { id: "desc" }],
        });
        const daily =
          scoringConfig.dailyNeedSnapshot &&
          previous?.calculatedAt.toISOString().slice(0, 10) !==
            now.toISOString().slice(0, 10);
        if (
          previous &&
          Math.abs(previous.total - score.total) <
            scoringConfig.needHistoryThreshold &&
          previous.compositionHash === compositionHash &&
          previous.algorithmVersion === scoringConfig.algorithmVersion &&
          !daily
        )
          return { written: false, score: previous };
        await tx.clubNeedHistory.updateMany({
          where: { clubId: club.id, role, isCurrent: true },
          data: { isCurrent: false },
        });
        const { reasons, warnings, ...values } = score;
        const current = await tx.clubNeedHistory.create({
          data: {
            ...values,
            compositionHash,
            reasonsJson: JSON.stringify(reasons),
            warningsJson: JSON.stringify(warnings),
            algorithmVersion: scoringConfig.algorithmVersion,
            calculatedAt: now,
          },
        });
        // First observations and unassessed -> assessed transitions are not score-change claims.
        const event = scoreChangeEvent(
          "CLUB_NEED",
          previous?.available && current.available ? previous.total : null,
          current.total,
        );
        if (event)
          await tx.clubEvent.create({
            data: {
              ...event,
              clubId: club.id,
              dedupeKey: `need:${current.id}`,
              metadata: JSON.stringify({
                role,
                previousHistoryId: previous!.id,
                historyId: current.id,
              }),
            },
          });
        return { written: true, score: current };
      });
      results.push(row);
    }
  return results;
}
export async function recalculateAllScores(now = new Date()) {
  const players = await recalculateAllPlayerOpportunities(now);
  const clubs = await recalculateAllClubNeeds(now);
  return {
    calculatedAt: now,
    players,
    clubNeeds: clubs.map((c) => c.score),
    clubHistoryRowsWritten: clubs.filter((c) => c.written).length,
  };
}
