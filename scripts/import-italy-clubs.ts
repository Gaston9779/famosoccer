import "dotenv/config";
import { readFileSync } from "node:fs";
import type { Prisma } from "../src/generated/prisma/client";
import { db } from "../src/lib/db";
import {
  CLUB_COMPETITIONS,
  isClubCompetitionId,
  type ClubCompetitionId,
} from "../src/lib/club-competitions";
import { marketValueItalianFormat, normalizePosition, parseDate } from "../src/lib/normalization";

const source = "src/data/import/italy-clubs/italy_club_squads_2026_27_raw.json";
const apply = process.argv.includes("--apply");
const dryRun = process.argv.includes("--dry-run");

type RawPlayer = {
  tmPlayerId: string;
  tmUrl: string;
  name: string;
  shirtNumber: number | null;
  age: number;
  dateOfBirth: string | null;
  mainPosition: string | null;
  nationalities: string[];
  marketValueRaw: string | null;
  contractExpires: string | null;
  joinedDate: string | null;
};
type RawClub = {
  name: string;
  tmClubId: string;
  tmClubUrl: string | null;
  competitionKey: ClubCompetitionId;
  competitionName: string;
  country: string;
  squad: RawPlayer[];
};
type RawDocument = { metadata: { season: string }; clubs: RawClub[] };
type PlannedClub = RawClub & { existingId: string | null };
type PlannedPlayer = {
  raw: RawPlayer;
  club: PlannedClub;
  existing: {
    id: string;
    clubId: string | null;
    confirmedFreeAgent: boolean;
    club: { name: string } | null;
  } | null;
  normalizedPosition: ReturnType<typeof normalizePosition>;
  marketValueEur: number | null;
  birthDate: Date | null;
  contractExpires: Date | null;
  joinedDate: Date | null;
};

const nonEmpty = (value: string | null | undefined) => value?.trim() || null;
const parsedDate = (value: string | null) => value && value !== "-" ? parseDate(value) : null;
const validAge = (value: number) => Number.isInteger(value) && value >= 0 && value <= 100;

function validationErrors(document: RawDocument) {
  const errors: string[] = [];
  if (document.metadata.season !== "2026/27") errors.push("metadata.season must be 2026/27");
  if (!Array.isArray(document.clubs) || document.clubs.length !== 40) errors.push("expected exactly 40 clubs");
  for (const club of document.clubs) {
    if (!isClubCompetitionId(club.competitionKey) || club.competitionKey === "UZ1")
      errors.push(`invalid competition for ${club.name}`);
    if (!/^\d+$/.test(String(club.tmClubId))) errors.push(`invalid tmClubId for ${club.name}`);
    if (!Array.isArray(club.squad) || !club.squad.length) errors.push(`empty squad for ${club.name}`);
    for (const player of club.squad ?? []) {
      if (!/^\d+$/.test(String(player.tmPlayerId))) errors.push(`invalid tmPlayerId for ${club.name}/${player.name}`);
      if (!nonEmpty(player.name)) errors.push(`missing name for ${club.name}/${player.tmPlayerId}`);
      if (!validAge(player.age)) errors.push(`invalid age for ${club.name}/${player.tmPlayerId}`);
    }
  }
  return errors;
}

function playerWrite(plan: PlannedPlayer, clubId: string): Prisma.PlayerUpdateInput {
  const raw = plan.raw;
  const mainPosition = nonEmpty(raw.mainPosition);
  const data: Prisma.PlayerUpdateInput = {
    club: { connect: { id: clubId } },
    careerStatus: "ACTIVE",
    confirmedFreeAgent: false,
  };
  if (nonEmpty(raw.name)) data.name = raw.name.trim();
  if (nonEmpty(raw.tmUrl)) data.tmUrl = raw.tmUrl.trim();
  if (plan.birthDate) data.birthDate = plan.birthDate;
  if (validAge(raw.age)) data.age = raw.age;
  if (plan.normalizedPosition !== "UNKNOWN" && mainPosition) {
    data.mainPosition = mainPosition;
    data.positionGroup = plan.normalizedPosition;
  }
  if (raw.nationalities.length) data.nationalities = JSON.stringify(raw.nationalities);
  if (plan.marketValueEur !== null) {
    data.marketValueEur = plan.marketValueEur;
    data.marketValueRaw = raw.marketValueRaw!.trim();
  }
  if (plan.contractExpires) data.contractExpires = plan.contractExpires;
  if (plan.joinedDate) data.joinedDate = plan.joinedDate;
  if (raw.shirtNumber !== null) data.shirtNumber = String(raw.shirtNumber);
  return data;
}

function playerCreate(plan: PlannedPlayer, clubId: string): Prisma.PlayerCreateInput {
  const raw = plan.raw;
  const mainPosition = nonEmpty(raw.mainPosition);
  const data: Prisma.PlayerCreateInput = {
    tmPlayerId: String(raw.tmPlayerId),
    tmUrl: raw.tmUrl,
    name: raw.name,
    club: { connect: { id: clubId } },
    careerStatus: "ACTIVE",
    confirmedFreeAgent: false,
  };
  if (plan.birthDate) data.birthDate = plan.birthDate;
  if (validAge(raw.age)) data.age = raw.age;
  if (plan.normalizedPosition !== "UNKNOWN" && mainPosition) {
    data.mainPosition = mainPosition;
    data.positionGroup = plan.normalizedPosition;
  }
  if (raw.nationalities.length) data.nationalities = JSON.stringify(raw.nationalities);
  if (plan.marketValueEur !== null) {
    data.marketValueEur = plan.marketValueEur;
    data.marketValueRaw = raw.marketValueRaw!.trim();
  }
  if (plan.contractExpires) data.contractExpires = plan.contractExpires;
  if (plan.joinedDate) data.joinedDate = plan.joinedDate;
  if (raw.shirtNumber !== null) data.shirtNumber = String(raw.shirtNumber);
  return data;
}

async function main() {
  if (apply === dryRun) throw new Error("Use exactly one of --dry-run or --apply");
  const document = JSON.parse(readFileSync(source, "utf8")) as RawDocument;
  const errors = validationErrors(document);
  const rows = document.clubs.flatMap((club) => club.squad.map((player) => ({ club, player })));
  const ids = rows.map(({ player }) => String(player.tmPlayerId));
  const duplicateTmPlayerIds = ids.length - new Set(ids).size;
  const clubsByCompetition = Object.fromEntries(
    (["IT1", "IT2"] as const).map((competition) => [
      competition,
      document.clubs.filter((club) => club.competitionKey === competition).length,
    ]),
  );

  const [competitions, existingClubs, existingPlayers] = await Promise.all([
    db.competition.findMany({ where: { tmCompetitionId: { in: ["IT1", "IT2"] } }, select: { id: true, tmCompetitionId: true } }),
    db.club.findMany({ where: { tmClubId: { in: document.clubs.map((club) => String(club.tmClubId)) } }, select: { id: true, tmClubId: true, name: true, competitionId: true } }),
    db.player.findMany({
      where: { tmPlayerId: { in: ids } },
      select: { id: true, tmPlayerId: true, clubId: true, confirmedFreeAgent: true, club: { select: { name: true } } },
    }),
  ]);
  const clubByTmId = new Map(existingClubs.map((club) => [club.tmClubId, club]));
  const playerByTmId = new Map(existingPlayers.map((player) => [player.tmPlayerId, player]));
  const plannedClubs = document.clubs.map((club) => ({ ...club, existingId: clubByTmId.get(String(club.tmClubId))?.id ?? null }));
  const plannedClubByTmId = new Map(plannedClubs.map((club) => [String(club.tmClubId), club]));
  const plannedPlayers: PlannedPlayer[] = rows.map(({ club, player }) => {
    const normalizedPosition = normalizePosition(player.mainPosition);
    return {
      raw: player,
      club: plannedClubByTmId.get(String(club.tmClubId))!,
      existing: playerByTmId.get(String(player.tmPlayerId)) ?? null,
      normalizedPosition,
      marketValueEur: marketValueItalianFormat(player.marketValueRaw),
      birthDate: parsedDate(player.dateOfBirth),
      contractExpires: parsedDate(player.contractExpires),
      joinedDate: parsedDate(player.joinedDate),
    };
  });

  const clubsToUpdate = plannedClubs.filter((club) => {
    const existing = clubByTmId.get(String(club.tmClubId));
    return existing && (existing.name !== club.name || existing.competitionId !== competitions.find((row) => row.tmCompetitionId === club.competitionKey)?.id);
  });
  const currentClubChanges = plannedPlayers.filter((plan) => plan.existing?.clubId && plan.existing.clubId !== plan.club.existingId);
  const nullClubFixes = plannedPlayers.filter((plan) => plan.existing?.clubId === null);
  const correctClub = plannedPlayers.filter((plan) => plan.existing?.clubId !== null && plan.existing?.clubId === plan.club.existingId);
  const freeAgentConflicts = plannedPlayers.filter((plan) => plan.existing?.confirmedFreeAgent);
  const invalidDateCount = plannedPlayers.filter((plan) =>
    (plan.raw.dateOfBirth && plan.raw.dateOfBirth !== "-" && !plan.birthDate) ||
    (plan.raw.contractExpires && plan.raw.contractExpires !== "-" && !plan.contractExpires) ||
    (plan.raw.joinedDate && plan.raw.joinedDate !== "-" && !plan.joinedDate),
  ).length;
  const report = {
    mode: apply ? "APPLY" : "DRY_RUN",
    rawData: {
      it1Clubs: clubsByCompetition.IT1,
      it2Clubs: clubsByCompetition.IT2,
      totalClubs: document.clubs.length,
      totalSquadRows: rows.length,
      uniqueTmPlayerId: new Set(ids).size,
    },
    competitions: {
      existing: competitions.map((competition) => competition.tmCompetitionId),
      toCreate: (["IT1", "IT2"] as const).filter((competition) => !competitions.some((row) => row.tmCompetitionId === competition)),
    },
    clubs: {
      alreadyExisting: plannedClubs.filter((club) => club.existingId).length,
      toCreate: plannedClubs.filter((club) => !club.existingId).length,
      toUpdate: clubsToUpdate.length,
    },
    players: {
      alreadyExisting: plannedPlayers.filter((plan) => plan.existing).length,
      toCreate: plannedPlayers.filter((plan) => !plan.existing).length,
      toUpdate: plannedPlayers.filter((plan) => plan.existing).length,
    },
    currentClub: {
      existingPlayersWithClubIdNullToFix: nullClubFixes.length,
      existingPlayersAlreadyAtCorrectClub: correctClub.length,
      changes: currentClubChanges.length,
    },
    status: { incorrectlyMarkedConfirmedFreeAgent: freeAgentConflicts.length },
    dataQuality: {
      missingNormalizedPosition: plannedPlayers.filter((plan) => plan.normalizedPosition === "UNKNOWN").length,
      missingParsedMarketValue: plannedPlayers.filter((plan) => plan.marketValueEur === null).length,
      missingContract: plannedPlayers.filter((plan) => plan.raw.contractExpires === null || plan.raw.contractExpires === "-").length,
      invalidDates: invalidDateCount,
      duplicateTmPlayerId: duplicateTmPlayerIds,
      unresolvedClub: plannedClubs.filter((club) => !/^\d+$/.test(String(club.tmClubId))).length,
      unresolvedPlayer: plannedPlayers.filter((plan) => !/^\d+$/.test(String(plan.raw.tmPlayerId))).length,
    },
    validationErrors: errors,
    clubChangeExamples: [...nullClubFixes, ...currentClubChanges]
      .slice(0, 20)
      .map((plan) => ({
        player: plan.raw.name,
        tmPlayerId: plan.raw.tmPlayerId,
        previousClub: plan.existing?.club?.name ?? null,
        newClub: plan.club.name,
        previousClubId: plan.existing?.clubId ?? null,
      })),
  };
  console.log(JSON.stringify(report, null, 2));
  if (!apply) return;

  const competitionByKey = new Map<string, string>();
  for (const key of ["IT1", "IT2"] as const) {
    const context = CLUB_COMPETITIONS[key];
    const competition = await db.competition.upsert({
      where: { tmCompetitionId: key },
      create: { tmCompetitionId: context.tmCompetitionId, name: context.displayName, country: context.country, season: context.currentSeason },
      update: { name: context.displayName, country: context.country, season: context.currentSeason },
    });
    competitionByKey.set(key, competition.id);
  }
  const clubIdByTmId = new Map<string, string>();
  for (const club of plannedClubs) {
    const saved = await db.club.upsert({
      where: { tmClubId: String(club.tmClubId) },
      create: { tmClubId: String(club.tmClubId), name: club.name, tmUrl: nonEmpty(club.tmClubUrl), competitionId: competitionByKey.get(club.competitionKey)!, lastSyncedAt: new Date() },
      update: { name: club.name, tmUrl: nonEmpty(club.tmClubUrl), competitionId: competitionByKey.get(club.competitionKey)!, lastSyncedAt: new Date() },
    });
    clubIdByTmId.set(saved.tmClubId, saved.id);
  }
  for (const plan of plannedPlayers) {
    const data = playerWrite(plan, clubIdByTmId.get(String(plan.club.tmClubId))!);
    if (plan.existing) await db.player.update({ where: { id: plan.existing.id }, data });
    else await db.player.create({ data: playerCreate(plan, clubIdByTmId.get(String(plan.club.tmClubId))!) });
  }
}

main().finally(() => db.$disconnect());
