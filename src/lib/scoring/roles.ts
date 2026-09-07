import type { Role } from "./config";
export function normalizeRole(raw?: string | null): Role {
  const p = raw
    ?.trim()
    .toLowerCase()
    .replace(/^(goalkeeper|defender|midfield|attack)\s*-\s*/, "");
  const roles: Record<string, Role> = {
    goalkeeper: "GK",
    torwart: "GK",
    portiere: "GK",
    "right-back": "RB",
    "right wing-back": "RB",
    "left-back": "LB",
    "left wing-back": "LB",
    "centre-back": "CB",
    "center-back": "CB",
    innenverteidiger: "CB",
    "difensore centrale": "CB",
    "defensive midfield": "DM",
    "central midfield": "CM",
    "attacking midfield": "AM",
    "right winger": "RW",
    "right midfield": "RW",
    "left winger": "LW",
    "left midfield": "LW",
    "centre-forward": "ST",
    "center-forward": "ST",
    "second striker": "ST",
  };
  return p ? (roles[p] ?? "UNKNOWN") : "UNKNOWN";
}
export function secondaryRoles(raw?: string | null): Role[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? [
          ...new Set(
            parsed
              .filter((x): x is string => typeof x === "string")
              .map(normalizeRole)
              .filter((r) => r !== "UNKNOWN"),
          ),
        ]
      : [];
  } catch {
    return [];
  }
}
