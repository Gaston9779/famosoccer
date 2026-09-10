import type { Performance } from "../transfermarkt/types";

export const currentUz1Performance = { season: "2026", competitionKey: "UZ1" } as const;
export const sportingFields = ["possibleGames", "gamesPlayed", "goals", "assists", "yellowCards", "secondYellowCards", "redCards", "startElevenPercent", "minutesPlayedPercent", "minutesPlayed"] as const;

/** The dashboard "Performance" coverage metric and this job share this predicate exactly. */
export const isCurrentUz1 = (row: Pick<Performance, "season" | "competitionKey">) => row.season === "2026" && row.competitionKey === "UZ1";

/** Canonical identity is a numeric Transfermarkt player id; seed placeholders are excluded. */
export const hasNumericTmId = (tmPlayerId: string) => /^\d+$/.test(tmPlayerId);

/** In-memory eligibility check, re-run against fresh DB state before every request. */
export const isEligible = (player: {
  tmPlayerId: string;
  performances: Pick<Performance, "season" | "competitionKey">[];
}) => hasNumericTmId(player.tmPlayerId) && !player.performances.some(isCurrentUz1);

/** The job may only ever hit the performance endpoint — never a profile or any other path. */
export const isPerformanceRequestPath = (pathname: string) =>
  /^\/player\/\d+\/performance-game$/.test(pathname);

// Empty/invalid fields never replace previously known values. Zero is useful data.
export function preparePerformances(incoming: Performance[], existing: Performance[]) {
  const rows = new Map(existing.map(row => [`${row.season}|${row.competitionKey}`, row]));
  const changes = new Map<string, { row: Performance; fields: string[] }>();
  for (const incomingRow of incoming) {
    if (!incomingRow.season.trim() || !incomingRow.competitionKey.trim() || !incomingRow.competitionName.trim()) continue;
    const row = { ...incomingRow };
    for (const field of sportingFields) {
      const value = row[field];
      const percent = field === "startElevenPercent" || field === "minutesPlayedPercent";
      if (value !== null && (!Number.isFinite(value) || value < 0 || (percent ? value > 100 : !Number.isInteger(value)))) row[field] = null;
    }
    if (!sportingFields.some(field => row[field] !== null)) continue;
    const key = `${row.season}|${row.competitionKey}`;
    const previous = rows.get(key);
    const fields = sportingFields.filter(field => row[field] !== null && row[field] !== previous?.[field]);
    if (previous) for (const field of sportingFields) row[field] ??= previous[field];
    row.competitionCode ??= previous?.competitionCode ?? null;
    rows.set(key, row);
    changes.set(key, { row, fields: [...new Set([...(changes.get(key)?.fields ?? []), ...fields])] });
  }
  return [...changes.values()];
}

export class PerformanceGate {
  attempts = 0;
  http200Canary = 0;
  usableCanary = 0;
  currentCanary = 0;
  consecutive404 = 0;
  consecutive200WithoutUseful = 0;
  consecutiveWithoutValid = 0;
  consecutiveZeroGain = 0;
  canaryPassed = false;
  stop: string | null = null;
  /** Hard request ceiling for the run; defaults to the periodic job's 50. */
  constructor(private maxAttempts = 50) {}
  record(status: number | null, usable: boolean, current: boolean, gain: boolean) {
    this.attempts++;
    if (this.attempts <= 5) {
      this.http200Canary += Number(status === 200);
      this.usableCanary += Number(usable);
      this.currentCanary += Number(current);
    }
    this.consecutive404 = status === 404 ? this.consecutive404 + 1 : 0;
    this.consecutive200WithoutUseful = status === 200 && !usable ? this.consecutive200WithoutUseful + 1 : 0;
    this.consecutiveWithoutValid = usable ? 0 : this.consecutiveWithoutValid + 1;
    this.consecutiveZeroGain = gain ? 0 : this.consecutiveZeroGain + 1;
    if (status === 403 || status === 429) this.stop = `HTTP ${status}`;
    else if (this.consecutive404 >= 3) this.stop = "3 consecutive HTTP 404";
    else if (this.consecutive200WithoutUseful >= 5) this.stop = "5 consecutive HTTP 200 with zero useful data";
    else if (this.consecutiveWithoutValid >= 5) this.stop = "5 consecutive responses without valid performance data";
    else if (this.consecutiveZeroGain >= 5) this.stop = "5 consecutive zero-gain responses";
    if (this.attempts === 5) {
      this.canaryPassed = this.http200Canary >= 3 && (this.usableCanary >= 3 || this.currentCanary >= 3);
      if (!this.canaryPassed) this.stop ??= "Canary failed";
    }
    if (this.attempts >= this.maxAttempts) this.stop ??= `${this.maxAttempts}-request limit reached`;
  }
}
