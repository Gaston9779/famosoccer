/**
 * STEP 1 — Normalizzazione svincolati francesi (<=30 anni) nel formato standard
 * FamoSoccer, stessa forma pre-enrichment già usata per il dataset ITA
 * (vedi normalize-ita-free-agents.ts): {metadata, players, performances,
 * rosterContextByPlayer}.
 *
 * Non fa alcuna richiesta di rete: usa solo il file raw.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { normalizePosition, marketValueItalianFormat } from "../src/lib/normalization";

type RawRecord = {
  age: number | null;
  freeAgentSince: string | null;
  lastClub: string | null;
  mainPosition: string | null;
  marketValueRaw: string | null;
  name: string;
  tmPlayerId: string | null;
  tmUrl: string | null;
};

const dir = "src/data/import/fra-free-agents";
const inputPath = `${dir}/french_free_agents_under30_raw.json`;
const outputPath = `${dir}/famosoccer_french_free_agents_2026_27.json`;

function splitName(name: string): { firstName: string; lastName: string | null } {
  const parts = name.trim().split(/\s+/);
  const [firstName, ...rest] = parts;
  return { firstName, lastName: rest.length ? rest.join(" ") : null };
}

function tmIdFromUrl(url: string | null): string | null {
  const match = url?.match(/\/spieler\/(\d+)/);
  return match ? match[1] : null;
}

function main() {
  const raw: RawRecord[] = JSON.parse(readFileSync(inputPath, "utf8"));

  const unresolved: RawRecord[] = [];
  const duplicateTmPlayerIds: string[] = [];
  const ageExcluded: RawRecord[] = [];
  const urlMismatches: { name: string; tmPlayerId: string; urlTmId: string | null }[] = [];
  const seenTmIds = new Set<string>();

  const players = [] as Record<string, unknown>[];
  const lastKnownClubByTmPlayerId: Record<string, { lastClub: string | null; freeAgentSince: string | null }> = {};

  for (const record of raw) {
    const tmPlayerId = record.tmPlayerId;
    const tmUrl = record.tmUrl;

    if (!tmPlayerId || !tmUrl || !/^\d+$/.test(tmPlayerId)) {
      unresolved.push(record);
      continue; // non inventiamo l'ID: il record resta fuori dal dataset normalizzato
    }
    const urlTmId = tmIdFromUrl(tmUrl);
    if (urlTmId && urlTmId !== tmPlayerId) {
      urlMismatches.push({ name: record.name, tmPlayerId, urlTmId });
      continue;
    }
    if (record.age != null && record.age > 30) {
      ageExcluded.push(record);
      continue;
    }
    if (seenTmIds.has(tmPlayerId)) {
      duplicateTmPlayerIds.push(tmPlayerId);
      continue;
    }
    seenTmIds.add(tmPlayerId);

    const { firstName, lastName } = splitName(record.name);
    const mainPosition = record.mainPosition ?? null;
    const positionGroup = mainPosition ? normalizePosition(mainPosition) : null;

    players.push({
      age: record.age ?? null,
      agencyName: null,
      agentRaw: null,
      birthDate: null,
      birthPlace: null,
      careerStatus: "FREE_AGENT",
      clubId: null,
      confirmedFreeAgent: true,
      contractExpires: null,
      contractOption: null,
      firstName,
      heightCm: null,
      id: `fra_${tmPlayerId}`,
      isFavorite: false,
      joinedDate: null,
      lastName,
      mainPosition,
      manuallyAdded: false,
      marketValueEur: marketValueItalianFormat(record.marketValueRaw),
      marketValueRaw: record.marketValueRaw ?? null,
      name: record.name,
      // Sconosciuta a questo stadio: verrà riempita dal profilo TM reale (enrichment).
      nationalities: "[]",
      performanceLastSyncedAt: null,
      portraitUrl: null,
      positionGroup,
      preferredFoot: "UNKNOWN",
      profileLastSyncedAt: null,
      representationStatus: "UNKNOWN",
      secondaryPositions: null,
      shirtNumber: null,
      tmPlayerId,
      tmUrl,
    });

    if (record.lastClub || record.freeAgentSince)
      lastKnownClubByTmPlayerId[tmPlayerId] = { lastClub: record.lastClub ?? null, freeAgentSince: record.freeAgentSince ?? null };
  }

  const output = {
    metadata: {
      generatedAt: new Date().toISOString(),
      seasonRequested: "2026/27",
      source: "Transfermarkt",
      pool: "FRA",
      criteria: {
        status: "free agent",
        maxAgeInclusive: 30,
      },
      inputFile: inputPath,
      rawRecords: raw.length,
      normalizedPlayers: players.length,
      unresolvedRecords: unresolved.map((r) => ({ name: r.name, age: r.age })),
      ageExcluded: ageExcluded.map((r) => ({ name: r.name, age: r.age })),
      urlMismatches,
      duplicateTmPlayerIds,
      // Informativo, NON usato dall'import DB (rosterContextByPlayer resta {}
      // di proposito: nessun club va assegnato a questi giocatori).
      lastKnownClubByTmPlayerId,
      note: "careerStatus=FREE_AGENT, confirmedFreeAgent=true, clubId=null per tutti i player di questo dataset. performances=[] in attesa dell'enrichment.",
    },
    players,
    performances: [] as unknown[],
    rosterContextByPlayer: {} as Record<string, unknown>,
  };

  writeFileSync(outputPath, JSON.stringify(output, null, 2));

  console.log(JSON.stringify({
    "STEP 1 — NORMALIZZAZIONE": true,
    "raw records": raw.length,
    "missing tmPlayerId in raw": raw.filter((r) => !r.tmPlayerId).length,
    "unresolved (excluded, need manual ID)": unresolved.map((r) => r.name),
    "age excluded (>30, excluded)": ageExcluded.map((r) => r.name),
    "tmUrl/tmPlayerId mismatches (excluded)": urlMismatches,
    "duplicate tmPlayerId (excluded)": duplicateTmPlayerIds,
    "normalized players written": players.length,
    "ageRange": players.length ? [Math.min(...players.map((p: any) => p.age)), Math.max(...players.map((p: any) => p.age))] : null,
    "players with marketValueEur resolved": players.filter((p: any) => p.marketValueEur != null).length,
    "players with marketValueEur null": players.filter((p: any) => p.marketValueEur == null).length,
    "positionGroup resolved": players.filter((p: any) => p.positionGroup != null).length,
    "positionGroup null (mainPosition mancante o non mappato)": players.filter((p: any) => p.positionGroup == null).length,
    output: outputPath,
    externalRequests: 0,
  }, null, 2));
}

main();
