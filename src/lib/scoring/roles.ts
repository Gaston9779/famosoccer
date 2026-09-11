import type { Role } from "./config";
import { normalizePosition } from "../normalization";

export type GenericRoleFallback = {
  mainPosition: Extract<Role, "CB" | "CM" | "ST">;
  positionGroup: "DEFENDER" | "MIDFIELDER" | "FORWARD";
};

/**
 * Transfermarkt sometimes publishes only a broad category. These are explicit
 * scouting fallbacks, used only when no detailed role is present in the source.
 */
export function genericRoleFallback(raw?: string | null): GenericRoleFallback | null {
  switch (raw?.trim().toLowerCase()) {
    case "defender": return { mainPosition: "CB", positionGroup: "DEFENDER" };
    case "midfield":
    case "midfielder": return { mainPosition: "CM", positionGroup: "MIDFIELDER" };
    case "attack":
    case "forward": return { mainPosition: "ST", positionGroup: "FORWARD" };
    default: return null;
  }
}

export function normalizeRole(raw?: string | null): Role {
  const position = normalizePosition(raw);
  if (position === "GK" || position === "CB" || position === "DM" || position === "CM" || position === "AM" || position === "ST")
    return position;
  const text = raw?.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase() ?? "";
  if (position === "FB") return /left|sinistr/.test(text) ? "LB" : "RB";
  if (position === "WINGER") return /left|sinistr/.test(text) ? "LW" : "RW";
  return "UNKNOWN";
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
