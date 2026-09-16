import uzbekistanDatabase from "@/data/club-intelligence/uzbekistan_football_prospect_database_2026.json";
import italyDatabase from "@/data/club-intelligence/italy_club_intelligence_2026_27.json";
import italySerieCDatabase from "@/data/club-intelligence/italy_serie_c_girone_a_club_intelligence_2026_27.json";
import type { ClubCompetitionId } from "../club-competitions";

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

/** Uzbekistan dataset: keyed by Prisma Club id. Preserved unchanged. */
type UzbekistanClubRecord = ClubContactData;
const uzbekistanClubs = uzbekistanDatabase.clubs as UzbekistanClubRecord[];

/** Italy dataset: keyed by Transfermarkt club id (tmClubId), covers IT1 + IT2. */
type ItalyDecisionMaker = {
  name: string;
  role: string;
  priority: string;
  confidence: string;
  sourceUrl: string | null;
};
type ItalyClubRecord = {
  tmClubId: string;
  clubName: string;
  competitionKey: "IT1" | "IT2" | "IT3A";
  decisionMakers: ItalyDecisionMaker[];
  officialContacts: {
    city: string | null;
    address: string | null;
    website: string | null;
    email: string | null;
    phone: string | null;
    leaguePage: string | null;
    sourceUrls: string[];
  };
};
const italyClubs = italyDatabase.clubs as ItalyClubRecord[];
const italySerieCClubs = italySerieCDatabase.clubs as ItalyClubRecord[];

function normalizeItalyClub(record: ItalyClubRecord): ClubContactData {
  return {
    club_id: record.tmClubId,
    club_name: record.clubName,
    country: "Italy",
    league: record.competitionKey === "IT1" ? "Serie A" : record.competitionKey === "IT2" ? "Serie B" : "Serie C - Girone A",
    city: record.officialContacts.city,
    contacts: record.decisionMakers.map((person) => ({
      name: person.name,
      role: person.role,
      priority: person.priority,
      confidence: person.confidence,
      profile_url: person.sourceUrl,
      profile_type: person.sourceUrl ? "club-personnel reference" : null,
    })),
    official_website: record.officialContacts.website,
    pfl_page: record.officialContacts.leaguePage,
    direct_email: record.officialContacts.email,
    direct_phone: record.officialContacts.phone,
    notes: null,
  };
}

export type ClubIdentity = {
  id: string;
  tmClubId: string;
  competition: ClubCompetitionId;
};

/**
 * Registry of per-competition Club Intelligence datasets. UZ1 keeps its
 * original lookup (by Prisma Club id); Italian competitions look up by
 * tmClubId, since that is the identity the extracted dataset was keyed on.
 * Add a new competition here once its dataset has been extracted.
 */
export function getClubContactData(club: ClubIdentity): ClubContactData | null {
  if (club.competition === "UZ1")
    return uzbekistanClubs.find((row) => row.club_id === club.id) ?? null;
  if (club.competition === "IT1" || club.competition === "IT2" || club.competition === "IT3A") {
    const record = [...italyClubs, ...italySerieCClubs].find(
      (row) => row.tmClubId === club.tmClubId && row.competitionKey === club.competition,
    );
    return record ? normalizeItalyClub(record) : null;
  }
  return null;
}
