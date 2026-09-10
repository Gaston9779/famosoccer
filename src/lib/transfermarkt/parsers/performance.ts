import { z } from "zod";
import { ProviderError } from "../errors";
import type { Performance } from "../types";
function numeric(value: unknown, percent = false): number | null {
  if (value == null || value === "-" || value === "") return null;
  const s = String(value)
    .replace(/[%′'\s]/g, "")
    .replace(/,(?=\d{3}(?:\D|$))/g, "")
    .replace(/\.(?=\d{3}(?:\D|$))/g, "");
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) && (!percent || n <= 100) ? n : null;
}

const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
const number = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : null;

/**
 * The public Leistungsdaten component fetches one record per game from TMAPI.
 * Aggregate only explicit game facts; unavailable card categories remain null.
 */
function parseTmapiGamePerformance(value: unknown): Performance[] | null {
  const root = record(value);
  const data = record(root?.data);
  const games = data?.performance;
  if (!Array.isArray(games)) return null;
  type Aggregate = {
    season: string; competitionKey: string; gameIds: Set<string>; appearances: number; starts: number;
    minutes: number; hasMinutes: boolean; goals: number; hasGoals: boolean; assists: number; hasAssists: boolean;
    yellow: number; hasYellow: boolean; secondYellow: number; hasSecondYellow: boolean; red: number; hasRed: boolean;
  };
  const groups = new Map<string, Aggregate>();
  for (const game of games) {
    const item = record(game); const info = record(item?.gameInformation); const stats = record(item?.statistics);
    const general = record(stats?.generalStatistics); const goals = record(stats?.goalStatistics);
    const cards = record(stats?.cardStatistics); const playing = record(stats?.playingTimeStatistics);
    const seasonInfo = record(info?.season); const season = typeof seasonInfo?.display === "string" ? seasonInfo.display : null;
    const competitionKey = typeof info?.competitionId === "string" ? info.competitionId : null;
    const gameId = typeof info?.gameId === "string" ? info.gameId : null;
    if (!season || !competitionKey || !gameId || !general || !playing) continue;
    const key = `${season}|${competitionKey}`;
    const aggregate = groups.get(key) ?? {
      season, competitionKey, gameIds: new Set(), appearances: 0, starts: 0,
      minutes: 0, hasMinutes: false, goals: 0, hasGoals: false, assists: 0, hasAssists: false,
      yellow: 0, hasYellow: false, secondYellow: 0, hasSecondYellow: false, red: 0, hasRed: false,
    };
    if (aggregate.gameIds.has(gameId)) continue;
    aggregate.gameIds.add(gameId);
    if (general.participationState === "played") {
      aggregate.appearances++;
      if (playing.isStarting === true) aggregate.starts++;
      const minutes = number(playing.playedMinutes); if (minutes !== null) { aggregate.minutes += minutes; aggregate.hasMinutes = true; }
      const goalsScored = number(goals?.goalsScoredTotal); if (goalsScored !== null) { aggregate.goals += goalsScored; aggregate.hasGoals = true; }
      const assists = number(goals?.assists); if (assists !== null) { aggregate.assists += assists; aggregate.hasAssists = true; }
      const yellow = number(cards?.yellowCardNet); if (yellow !== null) { aggregate.yellow += yellow; aggregate.hasYellow = true; }
      // TMAPI's observed response exposes yellowCardNet but no explicit second-yellow/red counter.
      const secondYellow = number(cards?.secondYellowCards); if (secondYellow !== null) { aggregate.secondYellow += secondYellow; aggregate.hasSecondYellow = true; }
      const red = number(cards?.redCards); if (red !== null) { aggregate.red += red; aggregate.hasRed = true; }
    }
    groups.set(key, aggregate);
  }
  return [...groups.values()].map((group) => {
    const possibleGames = group.gameIds.size;
    const competitionName = group.competitionKey === "UZ1" ? "Superliga" : group.competitionKey;
    return {
      season: group.season, competitionName, competitionCode: group.competitionKey, competitionKey: group.competitionKey,
      possibleGames, gamesPlayed: group.appearances, goals: group.hasGoals ? group.goals : null,
      assists: group.hasAssists ? group.assists : null, yellowCards: group.hasYellow ? group.yellow : null,
      secondYellowCards: group.hasSecondYellow ? group.secondYellow : null, redCards: group.hasRed ? group.red : null,
      startElevenPercent: possibleGames ? group.starts / possibleGames * 100 : null,
      minutesPlayedPercent: group.hasMinutes && possibleGames ? group.minutes / (possibleGames * 90) * 100 : null,
      minutesPlayed: group.hasMinutes ? group.minutes : null,
    };
  });
}
export function parsePerformance(text: string): Performance[] {
  // The legacy CEAPI response was JSON. Keep this branch only to read existing
  // offline fixtures; the provider no longer requests that endpoint.
  if (!text.trimStart().startsWith("[") && !text.trimStart().startsWith("{")) {
    if (/<tm-player-performance-(?:proxy|table-new)\b/i.test(text))
      throw new ProviderError(
        "SCHEMA",
        "The public Leistungsdaten HTML contains client-rendered performance components, not statistical rows. Nothing was persisted.",
      );
    throw new ProviderError("SCHEMA", "Performance page did not contain a supported statistics table");
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new ProviderError("SCHEMA", "Performance response is not JSON");
  }
  const tmapi = parseTmapiGamePerformance(value);
  if (tmapi) return tmapi;
  if (!Array.isArray(value) && value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    value = obj.performance ?? obj.performances ?? obj.data;
  }
  const parsed = z
    .array(
      z
        .object({
          nameSeason: z.union([z.string(), z.number()]),
          competitionDescription: z.string(),
        })
        .passthrough(),
    )
    .safeParse(value);
  if (!parsed.success)
    throw new ProviderError(
      "SCHEMA",
      `Unsupported performance schema: ${parsed.error.message}`,
    );
  return parsed.data.map((r) => {
    const link =
      typeof r.detailedStatsLink === "string" ? r.detailedStatsLink : "";
    const code =
      link.match(/\/wettbewerb\/([A-Z0-9]+)/)?.[1] ??
      (typeof r.competitionCode === "string" ? r.competitionCode : null);
    return {
      season: String(r.nameSeason),
      competitionName: r.competitionDescription,
      competitionCode: code,
      competitionKey: code ?? r.competitionDescription,
      possibleGames: numeric(r.possibleGames),
      gamesPlayed: numeric(r.gamesPlayed),
      goals: numeric(r.goalsScored),
      assists: numeric(r.assists),
      yellowCards: numeric(r.yellowCards),
      secondYellowCards: numeric(r.secondYellowCards),
      redCards: numeric(r.redCards),
      startElevenPercent: numeric(r.startElevenPercent, true),
      minutesPlayedPercent: numeric(r.minutesPlayedPercent, true),
      minutesPlayed: numeric(r.minutesPlayed),
    };
  });
}
export function currentLeaguePerformance<
  T extends Pick<Performance, "competitionCode" | "season" | "competitionKey">,
>(rows: T[], now = new Date()): T | null {
  const year = (s: string) => Number(s.match(/(?:19|20)\d{2}/)?.[0] ?? 0);
  return (
    rows
      .filter(
        (r) =>
          r.competitionCode === "UZ1" &&
          year(r.season) > 0 &&
          year(r.season) <= now.getUTCFullYear(),
      )
      .sort(
        (a, b) =>
          year(b.season) - year(a.season) ||
          b.season.localeCompare(a.season) ||
          a.competitionKey.localeCompare(b.competitionKey),
      )[0] ?? null
  );
}
