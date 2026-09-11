import "dotenv/config";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { db } from "../src/lib/db";

const args = process.argv.slice(2);
const inputAt = args.indexOf("--input");
const source = inputAt >= 0 ? args[inputAt + 1] : "src/data/import/ita-expat/famosoccer_italiani_estero_2026_27_ENRICHED_FULL.json";
const dryRun = args.includes("--dry-run");
const limitAt = args.indexOf("--limit");
const limit = limitAt >= 0 ? Number(args[limitAt + 1]) : Infinity;
const data = JSON.parse(readFileSync(source, "utf8"));
const normalize = (value: string | null | undefined) => (value ?? "").trim().toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
const date = (value: string | null) => value ? new Date(value) : null;
const nonNull = (row: Record<string, unknown>) => Object.fromEntries(Object.entries(row).filter(([, value]) => value !== null && value !== undefined));
const competitionId = (country: string, name: string) => `ITA_IMPORT_${createHash("sha1").update(`${normalize(country)}|${normalize(name)}`).digest("hex").slice(0, 16)}`;

async function main() {
  if (!source) throw new Error("Missing value for --input");
  if (limitAt >= 0 && (!Number.isFinite(limit) || limit < 0)) throw new Error("--limit must be a non-negative number");
  const players = data.players.slice(0, limit);
  const ids = new Set(players.map((p: any) => p.tmPlayerId));
  const duplicateIds = players.length - ids.size;
  // The enriched profile carries the canonical current-club identity.  The
  // seed roster context supplies country/competition metadata when available.
  const contexts = Object.fromEntries(players.map((p: any) => {
    const roster = data.rosterContextByPlayer[p.tmPlayerId] ?? null;
    const profileClub = p.currentClub ?? null;
    return [p.tmPlayerId, profileClub?.tmClubId ? { ...roster, ...profileClub } : roster];
  }));
  const valid = players.filter((p: any) => /^\d+$/.test(p.tmPlayerId) && p.age <= 30 && !String(p.nationalities).includes("San Marino"));
  const validTmIds: string[] = Array.from(new Set<string>(valid.map((p: any): string => String(p.tmPlayerId))));
  const validSourceIds = new Set(valid.map((p: any) => p.id));
  const existing = await db.player.findMany({ where: { tmPlayerId: { in: validTmIds } }, select: { id: true, tmPlayerId: true } }) as Array<{ id: string; tmPlayerId: string }>;
  const itaMemberships = await db.playerPool.findMany({ where: { playerId: { in: existing.map(player => player.id) }, poolKey: "ITA" }, select: { playerId: true } });
  const itaMemberIds = new Set(itaMemberships.map(membership => membership.playerId));
  const existingByTmId = new Map(existing.map(player => [player.tmPlayerId, player]));
  const clubContexts = [...new Map(valid.map((player: any) => {
    const context = contexts[player.tmPlayerId] as any;
    return [context?.tmClubId ? `tm:${context.tmClubId}` : `name:${normalize(context?.country)}|${normalize(context?.competitionName)}|${normalize(context?.name)}`, context];
  })).values()].filter(Boolean) as any[];
  const tmClubIds = [...new Set(clubContexts.map(context => context?.tmClubId).filter(Boolean).map(String))];
  const knownClubs = await db.club.findMany({ where: { tmClubId: { in: tmClubIds } }, select: { tmClubId: true } });
  const knownClubIds = new Set(knownClubs.map(club => club.tmClubId));
  const unnamedClubContexts = clubContexts.filter(context => !context.tmClubId && context.name);
  let unresolvedClubs = 0;
  for (const context of unnamedClubContexts) {
    const match = await db.club.findFirst({ where: { name: { equals: context.name, mode: "insensitive" }, competition: { is: { country: context.country ?? undefined, name: context.competitionName ?? undefined } } }, select: { id: true } });
    if (!match) unresolvedClubs++;
  }
  const performanceRows = data.performances.filter((row: any) => validSourceIds.has(row.playerId));
  const unresolvedPerformances = data.performances.length - performanceRows.length;
  const validationErrors = players.length - valid.length + duplicateIds + unresolvedPerformances;
  const report = {
    "dataset players": players.length,
    "existing players": existing.length,
    "new players": validTmIds.length - existing.length,
    "players to update": existing.length,
    "memberships ITA to create": validTmIds.filter(tmPlayerId => !itaMemberIds.has(existingByTmId.get(tmPlayerId)?.id ?? "")).length,
    "performances resolvable": performanceRows.length,
    "performances unresolved": unresolvedPerformances,
    "clubs new": tmClubIds.filter(tmClubId => !knownClubIds.has(tmClubId)).length,
    "clubs existing": knownClubs.length,
    "clubs unresolved": unresolvedClubs,
    "duplicate tmPlayerId": duplicateIds,
    "validation errors": validationErrors,
  };
  console.log(JSON.stringify(report, null, 2));
  if (dryRun) return;
  const stats:any = { playersInserted:0, playersUpdated:0, playersSkipped:players.length-valid.length, memberships:0, clubsInserted:0, clubsMatched:0, clubsUnresolved:0, performancesInserted:0, performancesUpdated:0, performancesSkipped:0, errors:[] as string[] };
  const playerByTemp = new Map<string,string>();
  for (const item of valid) {
    const context = contexts[item.tmPlayerId] as any; let clubId:string|null = null;
    try {
      if (context?.tmClubId) {
        const key = competitionId(context.country ?? "Unknown", context.competitionName ?? "Imported competition");
        const competition = await db.competition.upsert({ where:{tmCompetitionId:key}, create:{tmCompetitionId:key,name:context.competitionName ?? "Imported competition",country:context.country ?? "Unknown",season:"2026/27"}, update:{name:context.competitionName ?? "Imported competition",country:context.country ?? "Unknown"} });
        const prior = await db.club.findUnique({where:{tmClubId:String(context.tmClubId)}});
        const club = await db.club.upsert({where:{tmClubId:String(context.tmClubId)},create:{tmClubId:String(context.tmClubId),name:context.name,tmUrl:context.tmUrl,competitionId:competition.id},update:nonNull({name:context.name,tmUrl:context.tmUrl,competitionId:competition.id})}); clubId=club.id; stats[prior?"clubsMatched":"clubsInserted"]++;
      } else if (context?.name) { const matched = await db.club.findFirst({where:{name:{equals:context.name,mode:"insensitive"},competition:{is:{country:context.country ?? undefined,name:context.competitionName ?? undefined}}}}); if (matched) {clubId=matched.id;stats.clubsMatched++;} else stats.clubsUnresolved++; }
      const existing = await db.player.findUnique({where:{tmPlayerId:item.tmPlayerId}});
      const row = nonNull({tmUrl:item.tmUrl,name:item.name,firstName:item.firstName,lastName:item.lastName,birthDate:date(item.birthDate),age:item.age,birthPlace:item.birthPlace,nationalities:item.nationalities,portraitUrl:item.portraitUrl,heightCm:item.heightCm,preferredFoot:item.preferredFoot,mainPosition:item.mainPosition,positionGroup:item.positionGroup,secondaryPositions:item.secondaryPositions,shirtNumber:item.shirtNumber,joinedDate:date(item.joinedDate),contractExpires:date(item.contractExpires),contractOption:item.contractOption,marketValueEur:item.marketValueEur,marketValueRaw:item.marketValueRaw,agentRaw:item.agentRaw,agencyName:item.agencyName,representationStatus:item.representationStatus,careerStatus:item.careerStatus,confirmedFreeAgent:item.confirmedFreeAgent,profileLastSyncedAt:date(item.profileLastSyncedAt),performanceLastSyncedAt:date(item.performanceLastSyncedAt),clubId});
      const player = await db.player.upsert({where:{tmPlayerId:item.tmPlayerId},create:{...row,tmPlayerId:item.tmPlayerId,tmUrl:item.tmUrl,name:item.name},update:row}); stats[existing?"playersUpdated":"playersInserted"]++; playerByTemp.set(item.id,player.id);
      const membership = await db.playerPool.upsert({where:{playerId_poolKey:{playerId:player.id,poolKey:"ITA"}},create:{playerId:player.id,poolKey:"ITA"},update:{}}); if (membership.createdAt.getTime() >= Date.now()-10_000) stats.memberships++;
    } catch (error) { stats.errors.push(`${item.tmPlayerId}: ${error instanceof Error ? error.message : String(error)}`); }
  }
  for (const perf of performanceRows) { const playerId=playerByTemp.get(perf.playerId); if (!playerId) {stats.performancesSkipped++;continue;} const existing=await db.playerPerformance.findUnique({where:{playerId_season_competitionKey:{playerId,season:perf.season,competitionKey:perf.competitionKey}}}); const row=nonNull({competitionName:perf.competitionName,competitionCode:perf.competitionCode,possibleGames:perf.possibleGames,gamesPlayed:perf.gamesPlayed,goals:perf.goals,assists:perf.assists,yellowCards:perf.yellowCards,secondYellowCards:perf.secondYellowCards,redCards:perf.redCards,startElevenPercent:perf.startElevenPercent,minutesPlayedPercent:perf.minutesPlayedPercent,minutesPlayed:perf.minutesPlayed,provider:perf.provider,providerStats:perf.providerStats,sourceUpdatedAt:date(perf.sourceUpdatedAt)}); await db.playerPerformance.upsert({where:{playerId_season_competitionKey:{playerId,season:perf.season,competitionKey:perf.competitionKey}},create:{...row,playerId,season:perf.season,competitionKey:perf.competitionKey,competitionName:perf.competitionName,sourceUpdatedAt:date(perf.sourceUpdatedAt) ?? new Date()},update:row}); stats[existing?"performancesUpdated":"performancesInserted"]++; }
  const [ita,uzb,other]=await Promise.all([db.player.count({where:{pools:{some:{poolKey:"ITA"}}}}),db.player.count({where:{club:{is:{competition:{is:{tmCompetitionId:"UZ1"}}}}}}),db.player.count({where:{AND:[{pools:{none:{poolKey:"ITA"}}},{NOT:{club:{is:{competition:{is:{tmCompetitionId:"UZ1"}}}}}}]}})]);
  console.log(JSON.stringify({"ITA EXPAT IMPORT REPORT":true,...stats,"ITA players in DB":ita,"UZ1 players in DB":uzb,"Other players in DB":other},null,2));
}
main().finally(()=>db.$disconnect());
