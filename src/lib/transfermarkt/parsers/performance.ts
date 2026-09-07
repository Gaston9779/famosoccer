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
export function parsePerformance(text: string): Performance[] {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new ProviderError("SCHEMA", "Performance response is not JSON");
  }
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
