import { readFile } from "node:fs/promises";
import { z } from "zod";
import { db } from "../db";
import type {
  Prisma,
  RepresentationStatus,
} from "../../generated/prisma/client";

const role = z.enum([
  "GK",
  "RB",
  "CB",
  "LB",
  "DM",
  "CM",
  "AM",
  "RW",
  "LW",
  "ST",
  "UNKNOWN",
]);
const nullableText = z.string().trim().min(1).nullable();
const performance = z
  .object({
    season: z.string().min(1),
    competitionName: z.string().min(1),
    competitionCode: z.string().min(1).nullable().optional(),
    competitionKey: z.string().min(1).optional(),
    possibleGames: z.number().int().nonnegative().nullable().optional(),
    gamesPlayed: z.number().int().nonnegative().nullable().optional(),
    goals: z.number().int().nonnegative().nullable().optional(),
    assists: z.number().int().nonnegative().nullable().optional(),
    yellowCards: z.number().int().nonnegative().nullable().optional(),
    secondYellowCards: z.number().int().nonnegative().nullable().optional(),
    redCards: z.number().int().nonnegative().nullable().optional(),
    startElevenPercent: z.number().min(0).max(100).nullable().optional(),
    minutesPlayedPercent: z.number().min(0).max(100).nullable().optional(),
    minutesPlayed: z.number().int().nonnegative().nullable().optional(),
  })
  .passthrough();
const seedSchema = z.object({
  meta: z.object({
    competitionCode: z.literal("UZ1"),
    asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }),
  clubs: z.array(
    z.object({
      name: z.string().trim().min(1),
      competitionCode: z.literal("UZ1"),
      sourceUrl: nullableText,
    }),
  ),
  players: z.array(
    z.object({
      seedKey: z.string().trim().min(1),
      name: z.string().trim().min(1),
      clubName: z.string().trim().min(1),
      competitionCode: z.literal("UZ1"),
      season: z.number().int(),
      sourcePositionGroup: z.enum(["GK", "DF", "MF", "FW"]),
      mainRole: role,
      exactRoleVerified: z.boolean(),
      birthDate: nullableText,
      nationalities: z.array(z.string().trim().min(1)),
      contractExpires: nullableText,
      confirmedFreeAgent: z.boolean(),
      representationStatus: z.enum([
        "NO_AGENT",
        "FAMILY",
        "AGENCY",
        "NOT_LISTED",
        "UNKNOWN",
      ]),
      agencyName: nullableText,
      marketValueEur: z.number().int().nonnegative().nullable(),
      tmPlayerId: nullableText,
      tmUrl: nullableText,
      performance: z.union([performance, z.array(performance)]).nullable(),
      importEligible: z.boolean(),
    }),
  ),
});

type Seed = z.infer<typeof seedSchema>;
type SeedPlayer = Seed["players"][number];

const clubAliases: Record<string, string> = {
  agmk: "fc okmk olmaliq",
  andijon: "fc andijon",
  buxoro: "fc buxoro",
  "dinamo samarkand": "dinamo samarqand",
  "mashal muborak": "mash al mubarek",
  "qizilqum zarafshon": "fc qizilqum",
  "kokand 1912": "fc kokand 1912",
  surkhon: "surkhon termiz",
};

function normalized(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function canonicalClubName(name: string) {
  return clubAliases[normalized(name)] ?? normalized(name);
}

function seedPlayerId(seedKey: string) {
  return `seed:${seedKey}`;
}

function rolePosition(
  value: SeedPlayer["mainRole"],
  exactRoleVerified: boolean,
) {
  if (!exactRoleVerified) return "UNKNOWN";
  return (
    {
      GK: "Goalkeeper",
      RB: "Right-Back",
      CB: "Centre-Back",
      LB: "Left-Back",
      DM: "Defensive Midfield",
      CM: "Central Midfield",
      AM: "Attacking Midfield",
      RW: "Right Winger",
      LW: "Left Winger",
      ST: "Centre-Forward",
      UNKNOWN: "UNKNOWN",
    } as const
  )[value];
}

function parsedDate(value: string | null) {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function nonEmpty(value: string | null) {
  return value !== null && value.trim() !== "" ? value.trim() : null;
}

function unknownText(value: string | null) {
  return value === null || value.trim() === "" || value === "UNKNOWN";
}

function hasNationalities(value: string) {
  try {
    return Array.isArray(JSON.parse(value)) && JSON.parse(value).length > 0;
  } catch {
    return false;
  }
}

function sameCommercialState(
  previous: {
    contractExpires: Date | null;
    representationStatus: RepresentationStatus;
    agencyName: string | null;
    marketValueEur: number | null;
    clubId: string | null;
  },
  next: typeof previous,
) {
  return (
    previous.contractExpires?.getTime() === next.contractExpires?.getTime() &&
    previous.representationStatus === next.representationStatus &&
    previous.agencyName === next.agencyName &&
    previous.marketValueEur === next.marketValueEur &&
    previous.clubId === next.clubId
  );
}

async function upsertSeedPerformances(
  tx: Prisma.TransactionClient,
  playerId: string,
  source: SeedPlayer["performance"],
  seedDate: Date,
) {
  if (!source) return;
  const rows = Array.isArray(source) ? source : [source];
  for (const item of rows) {
    const competitionCode = item.competitionCode ?? "UZ1";
    const competitionKey = item.competitionKey ?? competitionCode;
    const where = {
      playerId_season_competitionKey: {
        playerId,
        season: item.season,
        competitionKey,
      },
    };
    const existing = await tx.playerPerformance.findUnique({ where });
    const data = {
      competitionName: item.competitionName,
      competitionCode,
      possibleGames: existing?.possibleGames ?? item.possibleGames ?? null,
      gamesPlayed: existing?.gamesPlayed ?? item.gamesPlayed ?? null,
      goals: existing?.goals ?? item.goals ?? null,
      assists: existing?.assists ?? item.assists ?? null,
      yellowCards: existing?.yellowCards ?? item.yellowCards ?? null,
      secondYellowCards:
        existing?.secondYellowCards ?? item.secondYellowCards ?? null,
      redCards: existing?.redCards ?? item.redCards ?? null,
      startElevenPercent:
        existing?.startElevenPercent ?? item.startElevenPercent ?? null,
      minutesPlayedPercent:
        existing?.minutesPlayedPercent ?? item.minutesPlayedPercent ?? null,
      minutesPlayed: existing?.minutesPlayed ?? item.minutesPlayed ?? null,
    };
    await tx.playerPerformance.upsert({
      where,
      create: { ...data, playerId, season: item.season, competitionKey, sourceUpdatedAt: seedDate },
      update: data,
    });
  }
}

export type SeedImportResult = {
  clubsBefore: number;
  clubsAfter: number;
  playersBefore: number;
  playersAfter: number;
  newPlayersInserted: number;
  existingPlayersUpdated: number;
  duplicatesPrevented: number;
  importFailures: { seedKey: string; reason: string }[];
};

export async function importUzbekistanSeedFile(path: string): Promise<SeedImportResult> {
  const parsed = seedSchema.parse(JSON.parse(await readFile(path, "utf8")));
  return importUzbekistanSeed(parsed);
}

export async function importUzbekistanSeed(seed: Seed): Promise<SeedImportResult> {
  const seedDate = parsedDate(seed.meta.asOf);
  if (!seedDate) throw new Error("Seed asOf date is invalid");

  return db.$transaction(async (tx) => {
    const [competition, clubsBefore, playersBefore, existingClubs, existingPlayers] =
      await Promise.all([
        tx.competition.upsert({
          where: { tmCompetitionId: "UZ1" },
          create: {
            tmCompetitionId: "UZ1",
            name: "Uzbekistan Super League",
            country: "Uzbekistan",
            season: "2026",
          },
          update: {},
        }),
        tx.club.count(),
        tx.player.count(),
        tx.club.findMany(),
        tx.player.findMany(),
      ]);

    const clubsByCanonical = new Map(
      existingClubs.map((club) => [canonicalClubName(club.name), club]),
    );
    const clubsBySeedName = new Map<string, (typeof existingClubs)[number]>();

    for (const clubSeed of seed.clubs) {
      const canonical = canonicalClubName(clubSeed.name);
      let club = clubsByCanonical.get(canonical);
      if (!club) {
        club = await tx.club.create({
          data: {
            tmClubId: `seed:UZ1:${canonical.replaceAll(" ", "-")}`,
            name: clubSeed.name,
            tmUrl: nonEmpty(clubSeed.sourceUrl),
            competitionId: competition.id,
            lastSyncedAt: seedDate,
          },
        });
        clubsByCanonical.set(canonical, club);
      } else if (club.lastSyncedAt === null) {
        club = await tx.club.update({
          where: { id: club.id },
          data: { lastSyncedAt: seedDate },
        });
        clubsByCanonical.set(canonical, club);
      }
      clubsBySeedName.set(clubSeed.name, club);
    }

    const playersByTmId = new Map(existingPlayers.map((player) => [player.tmPlayerId, player]));
    const playersByClubAndName = new Map<string, (typeof existingPlayers)[number]>();
    for (const player of existingPlayers) {
      if (!player.clubId) continue;
      const key = `${player.clubId}:${normalized(player.name)}`;
      if (playersByClubAndName.has(key)) playersByClubAndName.delete(key);
      else playersByClubAndName.set(key, player);
    }

    const result: SeedImportResult = {
      clubsBefore,
      clubsAfter: clubsBefore,
      playersBefore,
      playersAfter: playersBefore,
      newPlayersInserted: 0,
      existingPlayersUpdated: 0,
      duplicatesPrevented: 0,
      importFailures: [],
    };

    for (const source of seed.players) {
      try {
        if (!source.importEligible) continue;
        const club = clubsBySeedName.get(source.clubName);
        if (!club) throw new Error(`Seed club not resolved: ${source.clubName}`);
        const externalId = nonEmpty(source.tmPlayerId) ?? seedPlayerId(source.seedKey);
        const nameKey = `${club.id}:${normalized(source.name)}`;
        const byId = playersByTmId.get(externalId);
        const byName = playersByClubAndName.get(nameKey);
        const existing = byId ?? byName;

        if (byId || byName) result.duplicatesPrevented++;
        const birthDate = parsedDate(source.birthDate);
        const contractExpires = parsedDate(source.contractExpires);
        const nationalities = source.nationalities.length
          ? JSON.stringify(source.nationalities)
          : null;
        const position = rolePosition(
          source.mainRole,
          source.exactRoleVerified,
        );

        if (!existing) {
          const player = await tx.player.create({
            data: {
              tmPlayerId: externalId,
              tmUrl: nonEmpty(source.tmUrl) ?? `seed://uz1/${source.seedKey}`,
              name: source.name,
              birthDate,
              nationalities: nationalities ?? "[]",
              mainPosition: position,
              positionGroup: source.sourcePositionGroup,
              clubId: club.id,
              contractExpires,
              confirmedFreeAgent: source.confirmedFreeAgent,
              representationStatus: source.representationStatus,
              agencyName: nonEmpty(source.agencyName),
              marketValueEur: source.marketValueEur,
            },
          });
          await tx.playerSnapshot.create({
            data: {
              playerId: player.id,
              contractExpires: player.contractExpires,
              representationStatus: player.representationStatus,
              agencyName: player.agencyName,
              marketValueEur: player.marketValueEur,
              clubId: player.clubId,
              capturedAt: seedDate,
            },
          });
          playersByTmId.set(player.tmPlayerId, player);
          playersByClubAndName.set(nameKey, player);
          await upsertSeedPerformances(tx, player.id, source.performance, seedDate);
          result.newPlayersInserted++;
          continue;
        }

        const next = {
          ...existing,
          birthDate: existing.birthDate ?? birthDate,
          nationalities:
            hasNationalities(existing.nationalities) || !nationalities
              ? existing.nationalities
              : nationalities,
          mainPosition:
            existing.tmPlayerId === seedPlayerId(source.seedKey) &&
            !source.exactRoleVerified
              ? "UNKNOWN"
              : unknownText(existing.mainPosition)
                ? position
                : existing.mainPosition,
          positionGroup:
            unknownText(existing.positionGroup)
              ? source.sourcePositionGroup
              : existing.positionGroup,
          clubId: existing.clubId ?? club.id,
          contractExpires: existing.contractExpires ?? contractExpires,
          confirmedFreeAgent:
            existing.confirmedFreeAgent || source.confirmedFreeAgent,
          representationStatus:
            existing.representationStatus === "UNKNOWN"
              ? source.representationStatus
              : existing.representationStatus,
          agencyName: nonEmpty(existing.agencyName) ?? nonEmpty(source.agencyName),
          marketValueEur: existing.marketValueEur ?? source.marketValueEur,
          tmUrl: nonEmpty(existing.tmUrl) ?? nonEmpty(source.tmUrl) ?? `seed://uz1/${source.seedKey}`,
        };
        const changed =
          next.birthDate?.getTime() !== existing.birthDate?.getTime() ||
          next.nationalities !== existing.nationalities ||
          next.mainPosition !== existing.mainPosition ||
          next.positionGroup !== existing.positionGroup ||
          next.clubId !== existing.clubId ||
          next.contractExpires?.getTime() !== existing.contractExpires?.getTime() ||
          next.confirmedFreeAgent !== existing.confirmedFreeAgent ||
          next.representationStatus !== existing.representationStatus ||
          next.agencyName !== existing.agencyName ||
          next.marketValueEur !== existing.marketValueEur ||
          next.tmUrl !== existing.tmUrl;
        if (changed) {
          const player = await tx.player.update({
            where: { id: existing.id },
            data: next,
          });
          if (!sameCommercialState(existing, player)) {
            await tx.playerSnapshot.create({
              data: {
                playerId: player.id,
                contractExpires: player.contractExpires,
                representationStatus: player.representationStatus,
                agencyName: player.agencyName,
                marketValueEur: player.marketValueEur,
                clubId: player.clubId,
                capturedAt: seedDate,
              },
            });
          }
          result.existingPlayersUpdated++;
        }
        await upsertSeedPerformances(
          tx,
          existing.id,
          source.performance,
          seedDate,
        );
      } catch (error) {
        result.importFailures.push({
          seedKey: source.seedKey,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }
    if (result.importFailures.length) {
      throw new Error(
        `Seed import rolled back: ${result.importFailures.length} failures: ${JSON.stringify(result.importFailures.slice(0, 5))}`,
      );
    }
    result.clubsAfter = await tx.club.count();
    result.playersAfter = await tx.player.count();
    return result;
  });
}
