import * as cheerio from "cheerio";
export function parseSquadPortraits(html: string) {
  const $ = cheerio.load(html);
  const rows = new Map<string, { tmPlayerId: string; portraitUrl: string | null }>();
  $('a[href*="/profil/spieler/"]').each((_, link) => {
    const id = $(link).attr("href")?.match(/\/spieler\/(\d+)/)?.[1];
    if (!id || rows.has(id)) return;
    const image = $(link).find("img").first();
    rows.set(id, { tmPlayerId: id, portraitUrl: image.attr("data-src") ?? image.attr("src") ?? null });
  });
  return [...rows.values()];
}
