import { db } from "../src/lib/db";

const normalized = (name: string) => name.normalize("NFKD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const numericTmId = (id: string) => /^\d+$/.test(id);

async function merge(canonicalId: string, duplicateId: string) {
  await db.$transaction(async (tx) => {
    const [canonical, duplicate] = await Promise.all([
      tx.player.findUniqueOrThrow({ where: { id: canonicalId } }),
      tx.player.findUniqueOrThrow({ where: { id: duplicateId } }),
    ]);
    if (!numericTmId(canonical.tmPlayerId) || !duplicate.tmPlayerId.startsWith("seed:"))
      throw new Error("Unsafe player identity merge requested");
    const duplicatePerformances = await tx.playerPerformance.findMany({ where: { playerId: duplicate.id } });
    for (const row of duplicatePerformances) {
      const existing = await tx.playerPerformance.findUnique({ where: { playerId_season_competitionKey: { playerId: canonical.id, season: row.season, competitionKey: row.competitionKey } } });
      if (!existing) await tx.playerPerformance.update({ where: { id: row.id }, data: { playerId: canonical.id } });
      else if (row.sourceUpdatedAt > existing.sourceUpdatedAt) await tx.playerPerformance.update({ where: { id: existing.id }, data: { possibleGames: row.possibleGames, gamesPlayed: row.gamesPlayed, goals: row.goals, assists: row.assists, yellowCards: row.yellowCards, secondYellowCards: row.secondYellowCards, redCards: row.redCards, startElevenPercent: row.startElevenPercent, minutesPlayedPercent: row.minutesPlayedPercent, minutesPlayed: row.minutesPlayed, sourceUpdatedAt: row.sourceUpdatedAt } });
    }
    await tx.playerPerformance.deleteMany({ where: { playerId: duplicate.id } });
    const duplicateCurrent = await tx.playerOpportunityHistory.findMany({ where: { playerId: duplicate.id, isCurrent: true } });
    if (duplicateCurrent.length && await tx.playerOpportunityHistory.count({ where: { playerId: canonical.id, isCurrent: true } })) await tx.playerOpportunityHistory.updateMany({ where: { playerId: duplicate.id, isCurrent: true }, data: { isCurrent: false } });
    await Promise.all([
      tx.playerSnapshot.updateMany({ where: { playerId: duplicate.id }, data: { playerId: canonical.id } }),
      tx.playerOpportunityHistory.updateMany({ where: { playerId: duplicate.id }, data: { playerId: canonical.id } }),
      tx.playerEvent.updateMany({ where: { playerId: duplicate.id }, data: { playerId: canonical.id } }),
      tx.playerNote.updateMany({ where: { playerId: duplicate.id }, data: { playerId: canonical.id } }),
    ]);
    for (const assignment of await tx.playerTagAssignment.findMany({ where: { playerId: duplicate.id } })) {
      await tx.playerTagAssignment.upsert({ where: { playerId_tagId: { playerId: canonical.id, tagId: assignment.tagId } }, create: { playerId: canonical.id, tagId: assignment.tagId }, update: {} });
    }
    await tx.playerTagAssignment.deleteMany({ where: { playerId: duplicate.id } });
    await tx.player.deleteMany({ where: { id: duplicate.id } });
  });
}

const players = await db.player.findMany({ orderBy: { id: "asc" } });
const realByName = new Map<string, typeof players>();
for (const player of players.filter((p) => numericTmId(p.tmPlayerId))) {
  const key = normalized(player.name);
  realByName.set(key, [...(realByName.get(key) ?? []), player]);
}
const candidates = players.flatMap((candidate) => {
  if (!candidate.tmPlayerId.startsWith("seed:")) return [];
  const matches = realByName.get(normalized(candidate.name)) ?? [];
  // A seed placeholder has no Transfermarkt identity. Merge only where its
  // normalized roster name maps to exactly one genuine TM player.
  return matches.length === 1 ? [{ canonicalId: matches[0].id, duplicateId: candidate.id }] : [];
});
const candidateCounts = new Map<string, number>();
for (const candidate of candidates) candidateCounts.set(candidate.canonicalId, (candidateCounts.get(candidate.canonicalId) ?? 0) + 1);
const pairs = candidates.filter((pair) => candidateCounts.get(pair.canonicalId) === 1);
for (let offset = 0; offset < pairs.length; offset += 12)
  await Promise.all(pairs.slice(offset, offset + 12).map((pair) => merge(pair.canonicalId, pair.duplicateId)));
console.log(JSON.stringify({ merged: pairs.length }));
await db.$disconnect();
