import { db } from "../db";
import { TransfermarktClient } from "../transfermarkt/client";
import { TransfermarktProvider } from "../transfermarkt/provider";
import { endpoints } from "../transfermarkt/endpoints";
import { BudgetError, ProviderError } from "../transfermarkt/errors";
import { configNumber } from "../transfermarkt/rateLimiter";
import { normalizePosition } from "../normalization";
import { shouldFetchPerformance } from "../scoring";
import { emptyCounts, savePerformance, saveProfile } from "./players";
import { finishRun, withSyncLock } from "./runs";
type State = {
  phase: "teams" | "rosters" | "profiles" | "performance" | "done";
  clubIds: string[];
  clubIndex: number;
  playerIds: string[];
  profileIndex: number;
  performanceIds: string[];
  performanceIndex: number;
  rosters: Record<string, string[]>;
  events: { type: string; player: string; from?: string; to?: string }[];
  errors: string[];
  estimatedRequests: number;
  small?: boolean;
};
const initial = (): State => ({
  phase: "teams",
  clubIds: [],
  clubIndex: 0,
  playerIds: [],
  profileIndex: 0,
  performanceIds: [],
  performanceIndex: 0,
  rosters: {},
  events: [],
  errors: [],
  estimatedRequests: 1,
});
export async function bootstrapUzbekistanSuperLeague(small = false) {
  return synchronize(small ? "SMALL" : "BOOTSTRAP");
}
export async function refreshUzbekistanSuperLeague() {
  return synchronize("DAILY");
}
async function synchronize(type: "BOOTSTRAP" | "SMALL" | "DAILY") {
  return withSyncLock(async () => {
    let max =
      type === "DAILY"
        ? configNumber("TM_DAILY_MAX_REQUESTS", 100)
        : type === "SMALL"
          ? 10
          : configNumber("TM_BOOTSTRAP_MAX_REQUESTS", 500);
    if (type === "DAILY") {
      const day = new Date();
      day.setUTCHours(0, 0, 0, 0);
      const used = await db.syncRun.aggregate({
        where: { type: "DAILY", startedAt: { gte: day } },
        _sum: { requestsAttempted: true },
      });
      max = Math.max(0, max - (used._sum.requestsAttempted ?? 0));
    }
    if (type !== "DAILY") {
      const probe = await db.syncRun.findFirst({
        where: { type: "PROBE" },
        orderBy: { startedAt: "desc" },
      });
      if (!probe || probe.status !== "SUCCESS")
        throw new ProviderError(
          "PROBE_REQUIRED",
          "Run npm run tm:probe successfully before bootstrap.",
        );
    }
    const previous = await db.syncRun.findFirst({
      where: { type },
      orderBy: { startedAt: "desc" },
    });
    const previousMeta = previous?.metadata
      ? JSON.parse(previous.metadata)
      : null;
    const state: State =
      previous && previous.status !== "SUCCESS" && previousMeta?.state
        ? previousMeta.state
        : initial();
    if (state.phase === "done") Object.assign(state, initial());
    const run = await db.syncRun.create({
      data: { type, metadata: JSON.stringify({ state }) },
    });
    const counts = emptyCounts();
    const provider = new TransfermarktProvider(
      new TransfermarktClient(run.id, max),
    );
    const persist = async () => {
      await db.syncRun.update({
        where: { id: run.id },
        data: { metadata: JSON.stringify({ state, counts }) },
      });
      const r = await db.syncRun.findUniqueOrThrow({ where: { id: run.id } });
      console.log(
        JSON.stringify({
          event: "sync.progress",
          runId: run.id,
          startTime: run.startedAt,
          elapsedSeconds: Math.round(
            (Date.now() - run.startedAt.getTime()) / 1000,
          ),
          requests: r.requestsAttempted,
          remainingEstimatedResources:
            state.phase === "done"
              ? 0
              : state.phase === "profiles"
                ? state.playerIds.length -
                  state.profileIndex +
                  state.playerIds.length
                : state.phase === "performance"
                  ? state.performanceIds.length - state.performanceIndex
                  : Math.max(0, state.estimatedRequests - r.requestsAttempted),
          successfulImports: counts.playersCreated + counts.playersUpdated,
          failures: state.errors.length,
          phase: state.phase,
          estimatedRequests: state.estimatedRequests,
          configuredMaximum: max,
        }),
      );
    };
    const resource = async (work: () => Promise<void>) => {
      try {
        await work();
      } catch (e) {
        if (
          e instanceof BudgetError ||
          (e instanceof ProviderError &&
            ["BLOCKED", "CIRCUIT_OPEN", "STOPPED", "NETWORK"].includes(e.code))
        )
          throw e;
        state.errors.push(e instanceof Error ? e.message : String(e));
      }
    };
    try {
      const competition = await db.competition.upsert({
        where: { tmCompetitionId: "UZ1" },
        create: {
          tmCompetitionId: "UZ1",
          name: "Uzbekistan Super League",
          country: "Uzbekistan",
          season: "UNVERIFIED",
        },
        update: {},
      });
      if (state.phase === "teams") {
        const clubs = await provider.teams();
        if (!clubs.length)
          throw new ProviderError("EMPTY_TEAMS", "UZ1 returned no clubs");
        for (const club of clubs) {
          const old = await db.club.findUnique({
            where: { tmClubId: club.id },
          });
          await db.club.upsert({
            where: { tmClubId: club.id },
            create: {
              tmClubId: club.id,
              name: club.name,
              tmUrl: club.link,
              competitionId: competition.id,
            },
            update: {
              name: club.name,
              tmUrl: club.link,
              competitionId: competition.id,
            },
          });
          counts[old ? "clubsUpdated" : "clubsCreated"]++;
        }
        state.clubIds = clubs.map((c) => c.id);
        state.phase = "rosters";
        const known = await db.player.count({
          where: { club: { competitionId: competition.id } },
        });
        state.estimatedRequests =
          1 +
          (type === "SMALL" ? 1 : clubs.length) +
          (type === "SMALL" ? 3 : known * 2);
        console.log(
          `Estimated Transfermarkt requests: ${state.estimatedRequests} (player count provisional until rosters complete). Configured maximum: ${max}`,
        );
        await persist();
      }
      if (state.phase === "rosters") {
        const limit =
          type === "SMALL"
            ? Math.min(1, state.clubIds.length)
            : state.clubIds.length;
        while (state.clubIndex < limit) {
          const tmClubId = state.clubIds[state.clubIndex];
          const club = await db.club.findUniqueOrThrow({ where: { tmClubId } });
          // A failed roster must not be treated as an empty squad.
          const players = await provider.players(tmClubId);
          if (!players.length)
            throw new ProviderError(
              "EMPTY_ROSTER",
              `Empty roster for ${club.name}; no departures inferred.`,
            );
          state.rosters[club.id] = players.map((p) => p.id);
          for (const p of players) {
            const old = await db.player.findUnique({
              where: { tmPlayerId: p.id },
            });
            if (!old)
              state.events.push({
                type: "NEW_PLAYER",
                player: p.id,
                to: club.id,
              });
            else if (old.clubId !== club.id)
              state.events.push({
                type: "PLAYER_CHANGED_CLUB",
                player: p.id,
                from: old.clubId ?? undefined,
                to: club.id,
              });
            const player = await db.player.upsert({
              where: { tmPlayerId: p.id },
              create: {
                tmPlayerId: p.id,
                name: p.name,
                tmUrl: p.link
                  ? new URL(p.link, "https://www.transfermarkt.com").href
                  : `https://www.transfermarkt.com${endpoints.profile(p.id)}`,
                shirtNumber: p.shirtNumber,
                positionGroup: normalizePosition(null, p.positionId),
                clubId: club.id,
              },
              update: {
                name: p.name,
                shirtNumber: p.shirtNumber,
                clubId: club.id,
              },
            });
            counts[old ? "playersUpdated" : "playersCreated"]++;
            if (!old || old.clubId !== club.id)
              await db.playerSnapshot.create({
                data: {
                  playerId: player.id,
                  clubId: player.clubId,
                  contractExpires: player.contractExpires,
                  representationStatus: player.representationStatus,
                  agencyName: player.agencyName,
                  marketValueEur: player.marketValueEur,
                },
              });
            if (!state.playerIds.includes(p.id)) state.playerIds.push(p.id);
          }
          await db.club.update({
            where: { id: club.id },
            data: { lastSyncedAt: new Date() },
          });
          state.clubIndex++;
          await persist();
        }
        if (type === "DAILY") {
          const departures = await db.player.findMany({
            where: {
              clubId: { in: Object.keys(state.rosters) },
              tmPlayerId: { notIn: state.playerIds },
            },
          });
          for (const p of departures) {
            state.events.push({
              type: "PLAYER_LEFT_ROSTER",
              player: p.tmPlayerId,
              from: p.clubId ?? undefined,
            });
            await db.$transaction([
              db.player.update({ where: { id: p.id }, data: { clubId: null } }),
              db.playerSnapshot.create({
                data: {
                  playerId: p.id,
                  clubId: null,
                  contractExpires: p.contractExpires,
                  representationStatus: p.representationStatus,
                  agencyName: p.agencyName,
                  marketValueEur: p.marketValueEur,
                },
              }),
            ]);
          }
        }
        if (type === "SMALL") state.playerIds = state.playerIds.slice(0, 3);
        if (type === "DAILY") {
          const cutoff = new Date(
            Date.now() - configNumber("TM_PROFILE_TTL_DAYS", 7) * 86400000,
          );
          const due = await db.player.findMany({
            where: {
              tmPlayerId: { in: state.playerIds },
              OR: [
                { profileLastSyncedAt: null },
                { profileLastSyncedAt: { lt: cutoff } },
              ],
            },
            orderBy: { profileLastSyncedAt: "asc" },
          });
          state.playerIds = due.map((p) => p.tmPlayerId);
        }
        state.estimatedRequests = 1 + limit + state.playerIds.length * 2;
        state.phase = "profiles";
        await persist();
      }
      if (state.phase === "profiles") {
        while (state.profileIndex < state.playerIds.length) {
          const id = state.playerIds[state.profileIndex];
          await resource(async () => {
            const p = await db.player.findUniqueOrThrow({
              where: { tmPlayerId: id },
            });
            await saveProfile(
              await provider.fetchPlayerProfile(id, p.tmUrl),
              counts,
            );
          });
          state.profileIndex++;
          await persist();
        }
        const candidates = await db.player.findMany({
          where: {
            ...(type === "SMALL"
              ? { tmPlayerId: { in: state.playerIds } }
              : { club: { competitionId: competition.id } }),
            profileLastSyncedAt: { not: null },
          },
          orderBy: { performanceLastSyncedAt: "asc" },
        });
        state.performanceIds = candidates
          .filter(
            (p) =>
              shouldFetchPerformance(p) &&
              (type !== "DAILY" ||
                !p.performanceLastSyncedAt ||
                p.performanceLastSyncedAt.getTime() <
                  Date.now() -
                    configNumber("TM_PERFORMANCE_TTL_DAYS", 7) * 86400000),
          )
          .map((p) => p.tmPlayerId);
        state.estimatedRequests =
          1 +
          state.clubIndex +
          state.playerIds.length +
          state.performanceIds.length;
        state.phase = "performance";
        await persist();
      }
      if (state.phase === "performance") {
        while (state.performanceIndex < state.performanceIds.length) {
          const id = state.performanceIds[state.performanceIndex];
          await resource(async () => {
            const p = await db.player.findUniqueOrThrow({
              where: { tmPlayerId: id },
            });
            await savePerformance(p.id, await provider.performance(p.tmPlayerId), counts);
          });
          state.performanceIndex++;
          await persist();
        }
        state.phase = "done";
        await persist();
      }
      return await finishRun(
        run.id,
        state.errors.length
          ? new Error(
              `${state.errors.length} resources failed; details in metadata`,
            )
          : undefined,
        { state, counts },
      );
    } catch (error) {
      await persist();
      return await finishRun(run.id, error, { state, counts });
    }
  });
}
