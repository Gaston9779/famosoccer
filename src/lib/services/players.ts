import { db } from "../db";
import { TransfermarktClient } from "../transfermarkt/client";
import { TransfermarktProvider } from "../transfermarkt/provider";
import { playerUrl } from "../transfermarkt/endpoints";
import type { parseProfile } from "../transfermarkt/parsers/profile";
import type { Performance } from "../transfermarkt/types";
import { currentLeaguePerformance } from "../transfermarkt/parsers/performance";
import { scoringInputs } from "../scoring";
import { finishRun, withSyncLock } from "./runs";
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
        update: { tmUrl: currentClub.tmUrl },
      });
      counts[previous ? "clubsUpdated" : "clubsCreated"]++;
      if (clubId && clubId !== club.id)
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
    const player = await tx.player.upsert({
      where: { tmPlayerId: data.tmPlayerId },
      create: {
        ...data,
        clubId,
        manuallyAdded: manual,
        profileLastSyncedAt: new Date(),
      },
      update: {
        ...data,
        clubId,
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
  await db.$transaction(async (tx) => {
    for (const row of rows) {
      const where = {
        playerId_season_competitionKey: {
          playerId,
          season: row.season,
          competitionKey: row.competitionKey,
        },
      };
      const previous = await tx.playerPerformance.findUnique({ where });
      await tx.playerPerformance.upsert({
        where,
        create: { ...row, playerId, sourceUpdatedAt: new Date() },
        update: { ...row, sourceUpdatedAt: new Date() },
      });
      counts[previous ? "performanceRowsUpdated" : "performanceRowsCreated"]++;
    }
    await tx.player.update({
      where: { id: playerId },
      data: { performanceLastSyncedAt: new Date() },
    });
    const current = currentLeaguePerformance(rows);
    if (current)
      await tx.competition.updateMany({
        where: { tmCompetitionId: "UZ1" },
        data: { season: current.season },
      });
  });
}
export async function importPlayerFromTransfermarktUrl(url: string) {
  const parsed = playerUrl(url);
  return withSyncLock(async () => {
    const run = await db.syncRun.create({ data: { type: "MANUAL" } });
    const counts = emptyCounts();
    const provider = new TransfermarktProvider(
      new TransfermarktClient(run.id, 10),
    );
    try {
      const player = await saveProfile(
        await provider.fetchPlayerProfile(parsed.id, parsed.url),
        counts,
        true,
      );
      await savePerformance(
        player.id,
        await provider.performance(parsed.id),
        counts,
      );
      const complete = await db.player.findUniqueOrThrow({
        where: { id: player.id },
        include: { club: true, performances: true },
      });
      await finishRun(run.id, undefined, { counts });
      return { ...complete, ...scoringInputs(complete), syncRunId: run.id };
    } catch (error) {
      await finishRun(run.id, error, { counts });
      throw error;
    }
  });
}
