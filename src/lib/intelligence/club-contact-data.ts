import database from "@/data/club-intelligence/uzbekistan_football_prospect_database_2026.json";

type ClubContact = {
  name: string;
  role: string;
  priority: string;
  confidence: string;
  profile_url: string | null;
  profile_type: string | null;
};

export type ClubContactData = {
  club_id: string;
  club_name: string;
  country: string;
  league: string;
  city: string | null;
  contacts: ClubContact[];
  official_website: string | null;
  pfl_page: string | null;
  direct_email: string | null;
  direct_phone: string | null;
  notes: string | null;
};

const clubs = database.clubs as ClubContactData[];

/** Club IDs in this dataset are Prisma Club IDs; names are never used as keys. */
export function getClubContactData(clubId: string): ClubContactData | null {
  return clubs.find((club) => club.club_id === clubId) ?? null;
}
