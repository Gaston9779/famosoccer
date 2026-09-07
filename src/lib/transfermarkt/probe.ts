import { mkdir, writeFile } from "node:fs/promises";
import * as cheerio from "cheerio";
import { db } from "../db";
import { TransfermarktClient } from "./client";
import { endpoints, playerUrl } from "./endpoints";
import { parseListings } from "./parsers/listings";
import { parseProfile } from "./parsers/profile";
import {
  parsePerformance,
  currentLeaguePerformance,
} from "./parsers/performance";
import { finishRun, withSyncLock } from "../services/runs";
import { ProviderError } from "./errors";
export async function probe() {
  return withSyncLock(async () => {
    const run = await db.syncRun.create({ data: { type: "PROBE" } });
    const client = new TransfermarktClient(run.id, 10);
    const report: Record<string, unknown> = {
      teams: "NOT_RUN",
      players: "NOT_RUN",
      profile: "NOT_RUN",
      performance: "NOT_RUN",
    };
    let stage = "teams";
    console.log("TRANSFERMARKT PROBE");
    try {
      const teamsText = await client.request(endpoints.teams);
      const teams = parseListings(teamsText);
      if (!teams.length)
        throw new ProviderError("EMPTY_TEAMS", "No UZ1 clubs returned");
      report.teams = "PASS";
      report.clubs = teams.length;
      report.sampleClub = teams[0];
      stage = "players";
      const playersText = await client.request(endpoints.players(teams[0].id));
      const players = parseListings(playersText);
      if (!players.length)
        throw new ProviderError("EMPTY_ROSTER", "No players returned");
      report.players = "PASS";
      report.sampleClubPlayers = players.length;
      report.samplePlayer = players[0];
      const p = players[0];
      stage = "profile";
      const path = p.link
        ? playerUrl(new URL(p.link, "https://www.transfermarkt.com").href).path
        : endpoints.profile(p.id);
      const html = await client.request(path, "html");
      const profile = parseProfile(
        html,
        p.id,
        `https://www.transfermarkt.com${path}`,
      );
      report.profile = "PASS";
      report.profileFields = profile;
      await mkdir("tests/fixtures/transfermarkt", { recursive: true });
      const $ = cheerio.load(html);
      $('script,style,iframe,form,link[rel="stylesheet"]').remove();
      $("*").each((_, el) => {
        for (const key of Object.keys(
          ("attribs" in el ? el.attribs : {}) as object,
        ))
          if (/^on|token|nonce|session/i.test(key)) $(el).removeAttr(key);
      });
      const minimal = `<html><head><link rel="canonical" href="${profile.tmUrl}"></head><body>${$(".data-header").first().toString()}${$(".info-table").first().toString()}${$(".detail-position__box").first().toString()}</body></html>`;
      await writeFile(
        "tests/fixtures/transfermarkt/profile.live.html",
        minimal,
      );
      await writeFile(
        "tests/fixtures/transfermarkt/profile.live.meta.json",
        JSON.stringify({ id: p.id, url: profile.tmUrl }, null, 2),
      );
      stage = "performance";
      const raw = await client.request(endpoints.performance(p.id));
      const rows = parsePerformance(raw);
      report.performance = "PASS";
      report.seasonRows = rows.length;
      report.currentLeaguePerformance = currentLeaguePerformance(rows);
      // Save only validated public statistical fields, not headers/cookies.
      await writeFile(
        "tests/fixtures/transfermarkt/performance.live.json",
        JSON.stringify(JSON.parse(raw), null, 2),
      );
      await finishRun(run.id, undefined, { report });
    } catch (error) {
      report[stage] = "FAIL";
      report.error = error instanceof Error ? error.message : String(error);
      await finishRun(run.id, error, { report });
    }
    console.log(JSON.stringify(report, null, 2));
    return report;
  });
}
