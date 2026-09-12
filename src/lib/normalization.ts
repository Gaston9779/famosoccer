import type { PositionGroup, Representation } from "./transfermarkt/types";

const compactPosition = (value: string) => value
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .trim()
  .replace(/\s+/g, " ")
  .replace(/^\s*(?:difesa|centrocampo|attacco|goalkeeper|defender|midfield|attack)\s*-\s*/, "");

/**
 * Canonical Transfermarkt-to-FamoSoccer position mapping.  The stored values
 * are the project's established granular codes, shared by enrichment, scoring
 * and UI role rendering.
 */
const positionAliases: Record<string, PositionGroup> = {
  goalkeeper: "GK",
  torwart: "GK",
  portiere: "GK",
  porta: "GK",
  "centre-back": "CB",
  "center-back": "CB",
  innenverteidiger: "CB",
  difesa: "CB",
  difensore: "CB",
  "difensore centrale": "CB",
  "left-back": "FB",
  "right-back": "FB",
  "left wing-back": "FB",
  "right wing-back": "FB",
  "terzino destro": "FB",
  "terzino sinistro": "FB",
  "esterno destro di difesa": "FB",
  "esterno sinistro di difesa": "FB",
  "defensive midfield": "DM",
  mediano: "DM",
  "central midfield": "CM",
  centrocampo: "CM",
  centrocampista: "CM",
  centrale: "CM",
  mezzala: "CM",
  "attacking midfield": "AM",
  trequartista: "AM",
  "left winger": "WINGER",
  "right winger": "WINGER",
  "left midfield": "WINGER",
  "right midfield": "WINGER",
  "ala destra": "WINGER",
  "ala sinistra": "WINGER",
  "esterno destro": "WINGER",
  "esterno sinistro": "WINGER",
  "esterno di destra": "WINGER",
  "esterno di sinistra": "WINGER",
  "centre-forward": "ST",
  "center-forward": "ST",
  "second striker": "ST",
  attacco: "ST",
  attaccante: "ST",
  "seconda punta": "ST",
  "punta centrale": "ST",
  punta: "ST",
};

export function normalizePosition(
  raw?: string | null,
  positionId?: string | number | null,
): PositionGroup {
  const p = raw ? compactPosition(raw) : "";
  if (p && positionAliases[p]) return positionAliases[p];
  if (/^difesa\b/.test(compactPosition(raw ?? ""))) return "CB";
  if (/^centrocampo\b/.test(compactPosition(raw ?? ""))) return "CM";
  if (/^attacco\b/.test(compactPosition(raw ?? ""))) return "ST";
  // Quickselect IDs are coarse: observed 2 = defender, not a specific full-back.
  return String(positionId) === "1" ? "GK" : "UNKNOWN";
}
// Call only with text extracted from an agent/representation field. null means absent row.
export function normalizeRepresentation(agentRaw: string | null | undefined): {
  representationStatus: Representation;
  agencyName: string | null;
} {
  if (agentRaw == null)
    return { representationStatus: "NOT_LISTED", agencyName: null };
  const value = agentRaw.trim();
  const v = value.toLowerCase().replace(/\s+/g, " ");
  if (
    /^(no agent|without agent|without club\/agent|ohne berater|kein berater|senza agente|sin agente|sans agent)$/.test(
      v,
    )
  )
    return { representationStatus: "NO_AGENT", agencyName: null };
  if (
    /^(relatives|family|familie|famiglia|familia|family member|father|mother|brother|vater|mutter|bruder)$/.test(
      v,
    )
  )
    return { representationStatus: "FAMILY", agencyName: null };
  if (
    !v ||
    /^(unknown|not listed|n\/a|none|not available|unbekannt|sconosciuto|[-–—?])$/.test(
      v,
    ) ||
    !/[\p{L}]/u.test(v)
  )
    return { representationStatus: "UNKNOWN", agencyName: null };
  return { representationStatus: "AGENCY", agencyName: value };
}
export function parseDate(raw?: string | null): Date | null {
  if (!raw) return null;
  const text = raw.replace(/\s*\(\d+\)\s*$/, "").trim();
  const months: Record<string, number> = {
    jan: 1,
    feb: 2,
    mar: 3,
    apr: 4,
    may: 5,
    jun: 6,
    jul: 7,
    aug: 8,
    sep: 9,
    oct: 10,
    nov: 11,
    dec: 12,
  };
  let y: number, m: number, d: number;
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const eu = text.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
  const en = text.match(/^([A-Za-z]{3})\s+(\d{1,2}),?\s+(\d{4})$/);
  if (iso) [, y, m, d] = iso.map(Number);
  else if (eu) {
    d = +eu[1];
    m = +eu[2];
    y = +eu[3];
  } else if (en && months[en[1].toLowerCase()]) {
    m = months[en[1].toLowerCase()];
    d = +en[2];
    y = +en[3];
  } else return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d
    ? date
    : null;
}
export function marketValue(raw: string | null): number | null {
  const match = raw?.replace(/\s/g, "").match(/^€(\d+(?:\.\d+)?)(k|m|bn)?$/i);
  if (!match) return null;
  return Math.round(
    Number(match[1]) *
      ({ k: 1000, m: 1000000, bn: 1000000000 }[
        match[2]?.toLowerCase() as "k" | "m" | "bn"
      ] ?? 1),
  );
}

/**
 * Handles transfermarkt.it's Italian-language market value format ("X mila €",
 * "X,XX mln €"), distinct from marketValue() above which only parses TM.com's
 * "€X.Xm" style. Used by free-agent seed scripts (ITA, FRA, ...).
 */
export function marketValueItalianFormat(raw: string | null): number | null {
  if (!raw) return null;
  const mila = raw.match(/^(\d+)\s*mila\s*€$/i);
  if (mila) return Number(mila[1]) * 1_000;
  const mln = raw.match(/^(\d+(?:,\d+)?)\s*mln\s*€$/i);
  if (mln) return Math.round(Number(mln[1].replace(",", ".")) * 1_000_000);
  return null;
}

// Exact intelligence roles supplement the backward-compatible macro position groups.
export { normalizeRole } from "./scoring/roles";
