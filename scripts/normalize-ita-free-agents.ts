/**
 * STEP 1 — Normalizzazione svincolati italiani/oriundi nel formato standard FamoSoccer
 * già usato per il dataset "italiani all'estero" (vedi
 * famosoccer_italiani_estero_2026_27_REMAINING_917.json come riferimento di forma
 * pre-enrichment: stesso set di campi, stessa struttura {metadata, players,
 * performances, rosterContextByPlayer}).
 *
 * Non fa alcuna richiesta di rete: usa solo il file raw + le 2 risoluzioni di
 * tmPlayerId già verificate manualmente (vedi RESOLVED_MISSING_TM_IDS).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { normalizePosition } from "../src/lib/normalization";

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

const dir = "src/data/import/ita-expat";
const inputPath = `${dir}/italian_free_agents_raw_plus_17_oriundi.json`;
const outputPath = `${dir}/famosoccer_italiani_svincolati_2026_27.json`;

/**
 * I 2 record senza tmPlayerId/tmUrl nel raw sono stati risolti tramite ricerca
 * diretta su Transfermarkt (schnellsuche), NON inventati. Evidenza di match:
 *  - Youssef Nouri  -> unico risultato "svincolato", età 24, valore "50 mila €"
 *    (identico al raw) -> https://www.transfermarkt.it/youssef-nouri/profil/spieler/646874
 *  - Orgito Kuqi    -> unico risultato "svincolato", età 22, ruolo "POR" (Portiere,
 *    coerente col raw) -> https://www.transfermarkt.it/orgito-kuqi/profil/spieler/650251
 */
const RESOLVED_MISSING_TM_IDS: Record<string, { tmPlayerId: string; tmUrl: string; evidence: string }> = {
  "Youssef Nouri": {
    tmPlayerId: "646874",
    tmUrl: "https://www.transfermarkt.it/youssef-nouri/profil/spieler/646874",
    evidence: "unico risultato TM 'svincolato', età 24 e valore di mercato '50 mila €' identici al raw",
  },
  "Orgito Kuqi": {
    tmPlayerId: "650251",
    tmUrl: "https://www.transfermarkt.it/orgito-kuqi/profil/spieler/650251",
    evidence: "unico risultato TM 'svincolato', età 22 e ruolo 'POR' (Portiere) coerenti col raw",
  },
};

/** Formati osservati nel raw: "X mila €", "X,XX mln €" (nessun formato "€Xm" stile TM.com). */
function parseItalianMarketValue(raw: string | null): number | null {
  if (!raw) return null;
  const mila = raw.match(/^(\d+)\s*mila\s*€$/i);
  if (mila) return Number(mila[1]) * 1_000;
  const mln = raw.match(/^(\d+(?:,\d+)?)\s*mln\s*€$/i);
  if (mln) return Math.round(Number(mln[1].replace(",", ".")) * 1_000_000);
  return null;
}

function splitName(name: string): { firstName: string; lastName: string | null } {
  const parts = name.trim().split(/\s+/);
  const [firstName, ...rest] = parts;
  return { firstName, lastName: rest.length ? rest.join(" ") : null };
}

function main() {
  const raw: RawRecord[] = JSON.parse(readFileSync(inputPath, "utf8"));

  const resolvedIds: { name: string; tmPlayerId: string }[] = [];
  const unresolved: RawRecord[] = [];
  const duplicateTmPlayerIds: string[] = [];
  const seenTmIds = new Set<string>();

  const players = [] as Record<string, unknown>[];
  const lastKnownClubByTmPlayerId: Record<string, { lastClub: string | null; freeAgentSince: string | null }> = {};

  for (const record of raw) {
    let tmPlayerId = record.tmPlayerId;
    let tmUrl = record.tmUrl;

    if (!tmPlayerId || !tmUrl) {
      const resolution = RESOLVED_MISSING_TM_IDS[record.name];
      if (!resolution) {
        unresolved.push(record);
        continue; // non inventiamo l'ID: il record resta fuori dal dataset normalizzato
      }
      tmPlayerId = resolution.tmPlayerId;
      tmUrl = resolution.tmUrl;
      resolvedIds.push({ name: record.name, tmPlayerId });
    }

    if (!/^\d+$/.test(tmPlayerId)) {
      unresolved.push(record);
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
      id: `ita_${tmPlayerId}`,
      isFavorite: false,
      joinedDate: null,
      lastName,
      mainPosition,
      manuallyAdded: false,
      marketValueEur: parseItalianMarketValue(record.marketValueRaw),
      marketValueRaw: record.marketValueRaw ?? null,
      name: record.name,
      // Sconosciuta a questo stadio (potrebbero essere oriundi con doppia
      // cittadinanza): "[]" non è "meaningful" per lo script di enrichment,
      // quindi verrà riempita correttamente dal profilo TM reale (STEP 2).
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
      pool: "ITA",
      criteria: {
        status: "svincolato (free agent)",
        maxAgeInclusive: 30,
        includesOriundi: true,
      },
      inputFile: inputPath,
      rawRecords: raw.length,
      normalizedPlayers: players.length,
      resolvedMissingTmPlayerIds: resolvedIds,
      unresolvedRecords: unresolved.map((r) => ({ name: r.name, age: r.age })),
      duplicateTmPlayerIds,
      // Informativo, NON usato dall'import DB (rosterContextByPlayer resta {}
      // di proposito: nessun club va assegnato a questi giocatori).
      lastKnownClubByTmPlayerId,
      note: "careerStatus=FREE_AGENT, confirmedFreeAgent=true, clubId=null per tutti i player di questo dataset. performances=[] in attesa dell'enrichment (STEP 2).",
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
    "resolved via TM search (documented, not invented)": resolvedIds,
    "unresolved (excluded, need manual ID)": unresolved.map((r) => r.name),
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
