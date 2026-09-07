export type Representation =
  | "NO_AGENT"
  | "FAMILY"
  | "AGENCY"
  | "NOT_LISTED"
  | "UNKNOWN";
export type PositionGroup =
  | "GK"
  | "CB"
  | "FB"
  | "DM"
  | "CM"
  | "AM"
  | "WINGER"
  | "ST"
  | "UNKNOWN";
export interface Listing {
  id: string;
  name: string;
  link: string | null;
  shirtNumber?: string | null;
  positionId?: string | null;
}
export interface Performance {
  season: string;
  competitionName: string;
  competitionCode: string | null;
  competitionKey: string;
  possibleGames: number | null;
  gamesPlayed: number | null;
  goals: number | null;
  assists: number | null;
  yellowCards: number | null;
  secondYellowCards: number | null;
  redCards: number | null;
  startElevenPercent: number | null;
  minutesPlayedPercent: number | null;
  minutesPlayed: number | null;
}
