import "dotenv/config";
import * as cheerio from "cheerio";
import { writeFile, mkdir } from "node:fs/promises";
import { db } from "../src/lib/db";
import { TransfermarktClient } from "../src/lib/transfermarkt/client";

const COMPETITION = "IT3B";
const SEASON = "2026";
const OUT =
  "src/data/import/italy-clubs/italy_serie_c_girone_b_squads_2026_27_raw.json";

function text($: cheerio.CheerioAPI, el: any) {
  return $(el).text().replace(/\s+/g, " ").trim();
}

function extractClubId(href?: string) {
  return href?.match(/\/verein\/(\d+)/)?.[1] ?? null;
}

async function main() {
  const run = await db.syncRun.create({
    data: { type: "IT3B_SQUAD_EXTRACTION" },
  });
  const client = new TransfermarktClient(
    run.id,
    Number(process.env.TM_DAILY_MAX_REQUESTS ?? 100)
  );

  console.log("Fetching IT3A club list...");
  const competitionHtml = await client.request(
    `/serie-c-girone-a/startseite/wettbewerb/${COMPETITION}/saison_id/${SEASON}`,
    "html"
  );
  const $ = cheerio.load(competitionHtml);
  const clubsMap = new Map<
    string,
    { tmClubId: string; clubName: string; tmClubUrl: string }
  >();

  $('a[href*="/verein/"]').each((_, el) => {
    const href = $(el).attr("href");
    const clubId = extractClubId(href);
    if (!clubId || !href) return;
    const name = $(el).attr("title")?.trim() || text($, el);
    if (!name || name.length < 2 || clubsMap.has(clubId)) return;
    clubsMap.set(clubId, { tmClubId: clubId, clubName: name, tmClubUrl: href });
  });

  let clubs = [...clubsMap.values()];
  console.log(`Club candidates found: ${clubs.length}`);
  if (clubs.length > 20) clubs = clubs.slice(0, 20);
  if (clubs.length !== 20) {
    console.warn(`WARNING: expected 20 clubs, found ${clubs.length}. Inspect before import.`);
  }

  const outputClubs: any[] = [];
  for (let i = 0; i < clubs.length; i++) {
    const club = clubs[i];
    console.log(`[${i + 1}/${clubs.length}] ${club.clubName} (${club.tmClubId})`);
    const slug =
      club.tmClubUrl.match(/^\/([^/]+)\//)?.[1] ??
      club.clubName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const html = await client.request(
      `/${slug}/kader/verein/${club.tmClubId}/saison_id/${SEASON}`,
      "html"
    );
    const $$ = cheerio.load(html);

    const players = new Map<string, any>();

$$("table.items > tbody > tr").each((_, rowEl) => {
  const row = $$(rowEl);

  const playerLink = row.find('a[href*="/profil/spieler/"]').first();
  const href = playerLink.attr("href");

  if (!href) return;

  const tmPlayerId = href.match(/\/spieler\/(\d+)/)?.[1];

  if (!tmPlayerId || players.has(tmPlayerId)) return;

  const name =
    playerLink.attr("title")?.trim() ||
    playerLink.text().replace(/\s+/g, " ").trim();

  if (!name) return;

  // Player cell / nested player table
  const playerCell = playerLink.closest("table.inline-table");

  const playerLines = playerCell
    .find("tr")
    .map((_, tr) =>
      $$(tr)
        .text()
        .replace(/\s+/g, " ")
        .trim()
    )
    .get()
    .filter(Boolean);

  // Usually:
  // line 1 = player name
  // line 2 = position
  const mainPosition =
    playerLines.length >= 2
      ? playerLines[playerLines.length - 1]
      : null;

  const shirtNumber =
    row.find(".rn_nummer").first().text().replace(/\s+/g, "").trim() ||
    null;

  const portraitUrl =
    row.find('img[src*="portrait"], img[data-src*="portrait"]')
      .first()
      .attr("data-src") ??
    row.find('img[src*="portrait"], img[data-src*="portrait"]')
      .first()
      .attr("src") ??
    playerLink.find("img").first().attr("data-src") ??
    playerLink.find("img").first().attr("src") ??
    null;

  // Birth date + age
  const rowText = row.text().replace(/\s+/g, " ").trim();

  const dobAgeMatch =
    rowText.match(
      /(\d{1,2}\/\d{1,2}\/\d{4}|\d{1,2}\.\d{1,2}\.\d{4}|[A-Za-z]{3}\s+\d{1,2},\s+\d{4})\s*\((\d{1,2})\)/
    );

  const dateOfBirth = dobAgeMatch?.[1] ?? null;
  const ageCell = row.children("td").eq(2).text().trim();
  const age = /^\d{1,2}$/.test(ageCell)
    ? Number(ageCell)
    : dobAgeMatch
      ? Number(dobAgeMatch[2])
      : null;

  // Nationalities:
  // Ignore club badges / previous-club images by preferring flag images.
  const nationalities = row
    .find('img.flaggenrahmen[title]')
    .map((_, img) => $$(img).attr("title")?.trim())
    .get()
    .filter((v): v is string => Boolean(v));

  // Market value
  let marketValueRaw: string | null = null;

  row.find("td.rechts.hauptlink").each((_, td) => {
    const value = $$(td).text().replace(/\s+/g, " ").trim();

    if (
      /€|Th\.|mio\.|mil\.|mln|k\b|m\b/i.test(value) &&
      value !== "-"
    ) {
      marketValueRaw = value;
    }
  });

  // Fallback for current TM markup
  if (!marketValueRaw) {
    const candidate = row
      .find("td")
      .map((_, td) => $$(td).text().replace(/\s+/g, " ").trim())
      .get()
      .find(v =>
        /^(?:€\s*)?[\d.,]+\s*(?:Th\.|mio\.|mil\.|mln|k|m)$/i.test(v)
      );

    marketValueRaw = candidate ?? null;
  }

  // Extract cell text once for dates such as joined / contract
  const cells = row
    .children("td")
    .map((_, td) =>
      $$(td)
        .text()
        .replace(/\s+/g, " ")
        .trim()
    )
    .get();

  const standaloneDates = cells.filter(v =>
    /^(?:\d{1,2}\/\d{1,2}\/\d{4}|\d{1,2}\.\d{1,2}\.\d{4})$/.test(v)
  );

  // Transfermarkt normally exposes joined + contract as standalone
  // date cells. Do not invent values if markup is ambiguous.
  const joinedDate =
    standaloneDates.length >= 2
      ? standaloneDates[standaloneDates.length - 2]
      : null;

  const contractExpires =
    standaloneDates.length >= 1
      ? standaloneDates[standaloneDates.length - 1]
      : null;

  players.set(tmPlayerId, {
    tmPlayerId,
    tmUrl: href,
    name,
    shirtNumber,
    age,
    dateOfBirth,
    mainPosition,
    nationalities,
    marketValueRaw,
    contractExpires,
    joinedDate,
    portraitUrl,
  });
    });

    console.log(`   players: ${players.size}`);
    outputClubs.push({
      tmClubId: club.tmClubId,
      name: club.clubName,
      tmClubUrl: club.tmClubUrl,
      competitionKey: COMPETITION,
      squad: [...players.values()],
    });
  }

  const payload = {
    metadata: {
      season: "2026/27",
      competitionKey: COMPETITION,
      generatedAt: new Date().toISOString(),
      clubCount: outputClubs.length,
      squadRows: outputClubs.reduce((sum, club) => sum + club.squad.length, 0),
    },
    clubs: outputClubs,
  };

  await mkdir("src/data/import/italy-clubs", { recursive: true });
  await writeFile(OUT, JSON.stringify(payload, null, 2), "utf8");
  await db.syncRun.update({
    where: { id: run.id },
    data: { status: "SUCCESS", finishedAt: new Date() },
  });
  console.log(JSON.stringify({
    output: OUT,
    clubs: payload.metadata.clubCount,
    squadRows: payload.metadata.squadRows,
  }, null, 2));
  await db.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await db.$disconnect();
  process.exit(1);
});
