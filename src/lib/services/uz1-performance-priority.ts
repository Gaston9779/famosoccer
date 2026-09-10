import type { Performance } from "../transfermarkt/types";
import { hasNumericTmId, isCurrentUz1 } from "./uz1-performance-job";

/**
 * Local, request-free ranking of UZ1 players missing 2026/UZ1 Sporting data.
 *
 * Attempt history is read from prior SyncRun.metadata (no schema change) so a batch
 * never blindly re-hits a player that already returned 404 or produced zero gain.
 */

export type PerformanceAttempt = {
  tmPlayerId: string;
  at: string; // ISO
  status: number | null;
  /** OK = usable gain, EMPTY_404 = 404, ZERO_GAIN = 200 but nothing new, ERROR = other failure */
  result: "OK" | "EMPTY_404" | "ZERO_GAIN" | "ERROR";
};

export type PriorHistory = {
  attempts: number;
  count404: number;
  countZeroGain: number;
  countError: number;
  lastAt: string | null;
  lastResult: PerformanceAttempt["result"] | null;
};

const EMPTY_HISTORY: PriorHistory = { attempts: 0, count404: 0, countZeroGain: 0, countError: 0, lastAt: null, lastResult: null };

/** Merge per-tmPlayerId attempt outcomes across every prior UZ1 performance SyncRun. */
export function mergeAttemptHistory(
  runs: { startedAt: Date; metadata: string | null }[],
): Map<string, PriorHistory> {
  const merged = new Map<string, PriorHistory>();
  const ordered = [...runs].sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
  for (const run of ordered) {
    if (!run.metadata) continue;
    let meta: unknown;
    try {
      meta = JSON.parse(run.metadata);
    } catch {
      continue;
    }
    const attempts = extractAttempts(meta);
    for (const attempt of attempts) {
      const h = merged.get(attempt.tmPlayerId) ?? { ...EMPTY_HISTORY };
      h.attempts += 1;
      if (attempt.result === "EMPTY_404") h.count404 += 1;
      else if (attempt.result === "ZERO_GAIN") h.countZeroGain += 1;
      else if (attempt.result === "ERROR") h.countError += 1;
      h.lastAt = attempt.at;
      h.lastResult = attempt.result;
      merged.set(attempt.tmPlayerId, h);
    }
  }
  return merged;
}

function extractAttempts(meta: unknown): PerformanceAttempt[] {
  if (!meta || typeof meta !== "object") return [];
  const m = meta as Record<string, unknown>;
  // New shape: { attempts: PerformanceAttempt[] }
  if (Array.isArray(m.attempts))
    return (m.attempts as PerformanceAttempt[]).filter((a) => a && typeof a.tmPlayerId === "string");
  // Legacy shape: { results: [{ tmPlayerId, httpStatus, usefulGain, error }], report? }
  const results = Array.isArray(m.results)
    ? m.results
    : Array.isArray((m.report as Record<string, unknown>)?.results)
      ? ((m.report as Record<string, unknown>).results as unknown[])
      : [];
  return (results as Record<string, unknown>[])
    .filter((r) => typeof r.tmPlayerId === "string" || typeof r.tmPlayerId === "number")
    .map((r) => {
      const status = typeof r.httpStatus === "number" ? r.httpStatus : null;
      const gain = r.usefulGain === "YES" || r.usefulGain === true;
      const result: PerformanceAttempt["result"] =
        status === 404 ? "EMPTY_404" : r.error ? "ERROR" : gain ? "OK" : "ZERO_GAIN";
      return { tmPlayerId: String(r.tmPlayerId), at: "", status, result };
    });
}

export type RankablePlayer = {
  id: string;
  name: string;
  tmPlayerId: string;
  careerStatus: string;
  confirmedFreeAgent: boolean;
  profileLastSyncedAt: Date | null;
  performanceLastSyncedAt: Date | null;
  clubId: string | null;
  club: { name: string; lastSyncedAt: Date | null } | null;
  performances: Pick<Performance, "season" | "competitionKey">[];
  opportunityHistory: { playingTimeScore: number | null }[];
};

export type Scored = {
  player: RankablePlayer;
  score: number;
  prior: PriorHistory;
  reasons: string[];
  known404: boolean;
  repeatedFailure: boolean;
  unproductivePrior: boolean;
};

const DAYS = 86_400_000;

/** Priority rubric from the task. Pure, no I/O. Higher = request sooner. */
export function scoreCandidate(player: RankablePlayer, prior: PriorHistory, now: Date): Scored {
  const reasons: string[] = [];
  let score = 0;

  const authoritativeClub = !!player.clubId && !!player.club?.lastSyncedAt && player.careerStatus === "ACTIVE";
  const neverAttempted = !player.performanceLastSyncedAt && prior.attempts === 0;
  const playingTimeUnknown = !(player.opportunityHistory[0]?.playingTimeScore != null);
  const profileFreshDays = player.profileLastSyncedAt
    ? (now.getTime() - player.profileLastSyncedAt.getTime()) / DAYS
    : Infinity;

  if (player.profileLastSyncedAt) { score += 5; reasons.push("profile previously synced +5"); }
  if (authoritativeClub) { score += 4; reasons.push("authoritative UZ1 club +4"); }
  if (neverAttempted) { score += 3; reasons.push("never attempted +3"); }
  if (playingTimeUnknown) { score += 2; reasons.push("playing time unknown +2"); }
  if (profileFreshDays <= 14) { score += 1; reasons.push("profile fresh <=14d +1"); }

  // A prior performance check that never yielded a 2026/UZ1 row counts as one
  // unproductive attempt even when no SyncRun detail survives (performanceLastSyncedAt only).
  const impliedPriorMiss = !!player.performanceLastSyncedAt && prior.attempts === 0;
  const failures = prior.count404 + prior.countZeroGain + prior.countError + (impliedPriorMiss ? 1 : 0);
  const known404 = prior.count404 >= 1;
  const repeatedFailure = failures >= 2;
  if (repeatedFailure) { score -= 10; reasons.push(`>=2 prior performance failures -10`); }
  else if (prior.count404 === 1) { score -= 5; reasons.push("one prior 404 -5"); }
  else if (prior.countZeroGain === 1 || prior.countError === 1) { score -= 5; reasons.push("one prior zero-gain/error -5"); }
  else if (impliedPriorMiss) { score -= 5; reasons.push("prior performance check, no UZ1 2026 row -5"); }

  if (!authoritativeClub) { score -= 10; reasons.push("stale / non-authoritative club state -10"); }

  return { player, score, prior, reasons, known404, repeatedFailure, unproductivePrior: impliedPriorMiss || prior.count404 >= 1 || prior.countZeroGain >= 1 };
}

export type RankOptions = { includeRetired?: boolean; now?: Date };

/**
 * Full candidate ranking. Returns eligible candidates sorted best-first, plus the
 * excluded buckets for the report. Repeated-failure candidates are kept but sink
 * to the bottom (used only if nothing better remains).
 */
export function rankCandidates(
  players: RankablePlayer[],
  history: Map<string, PriorHistory>,
  options: RankOptions = {},
) {
  const now = options.now ?? new Date();
  const excluded = { covered: [] as string[], seedId: [] as string[], retired: [] as string[], freeAgent: [] as string[] };
  const eligible: Scored[] = [];

  for (const player of players) {
    if (player.performances.some(isCurrentUz1)) { excluded.covered.push(player.tmPlayerId); continue; }
    if (!hasNumericTmId(player.tmPlayerId)) { excluded.seedId.push(player.tmPlayerId); continue; }
    if (player.careerStatus === "RETIRED" && !options.includeRetired) { excluded.retired.push(player.tmPlayerId); continue; }
    if (player.careerStatus === "FREE_AGENT" || player.confirmedFreeAgent) { excluded.freeAgent.push(player.tmPlayerId); continue; }
    eligible.push(scoreCandidate(player, history.get(player.tmPlayerId) ?? { ...EMPTY_HISTORY }, now));
  }

  eligible.sort(
    (a, b) =>
      Number(a.repeatedFailure) - Number(b.repeatedFailure) || // repeated failures always last
      b.score - a.score ||
      a.player.tmPlayerId.localeCompare(b.player.tmPlayerId),
  );
  return { eligible, excluded };
}

export const BATCH_PLAN = [5, 20, 25, 25, 25] as const; // canary + 4 batches = 100
