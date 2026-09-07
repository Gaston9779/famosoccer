export const ROLES = [
  "GK",
  "RB",
  "CB",
  "LB",
  "DM",
  "CM",
  "AM",
  "RW",
  "LW",
  "ST",
  "UNKNOWN",
] as const;
export type Role = (typeof ROLES)[number];
export type KnownRole = Exclude<Role, "UNKNOWN">;
export const scoringConfig = {
  idealDepth: {
    GK: 3,
    RB: 2,
    CB: 4,
    LB: 2,
    DM: 2,
    CM: 4,
    AM: 2,
    RW: 2,
    LW: 2,
    ST: 3,
  } satisfies Record<KnownRole, number>,
  needHistoryThreshold: 2,
  eventThreshold: 10,
  dailyNeedSnapshot: false,
  performanceFreshDays: 7,
  minimumMarketContext: 5,
  algorithmVersion: "uz1-v1",
};
export const clamp = (n: number, max = 100) =>
  Math.max(0, Math.min(max, Number.isFinite(n) ? n : 0));
export const round = (n: number) =>
  Math.round((n + Number.EPSILON) * 100) / 100;
export const daysBetween = (date: Date, now: Date) =>
  Math.round(
    (Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) -
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())) /
      86400000,
  );
export function addMonths(date: Date, months: number) {
  const d = new Date(date);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0),
  ).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d;
}
