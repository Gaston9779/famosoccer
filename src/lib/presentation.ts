export function formatRepresentation(status: string, agencyName?: string | null) {
  if (status === "NO_AGENT") return "No agent";
  if (status === "FAMILY") return "Family representation";
  if (status === "NOT_LISTED") return "Not listed";
  if (status === "AGENCY") return agencyName || "Represented";
  return "Unknown";
}
export function representationTone(status: string): "green" | "amber" | "slate" {
  if (status === "NO_AGENT" || status === "FAMILY") return "green";
  if (status === "NOT_LISTED") return "amber";
  return "slate";
}
export function formatNationality(value: string | null | undefined) {
  const primary = value?.replace(/[\[\]"]/g, "").split(",")[0]?.trim();
  const countries: Record<string, [string, string]> = {
    Uzbekistan: ["🇺🇿", "UZB"], Russia: ["🇷🇺", "RUS"], Kazakhstan: ["🇰🇿", "KAZ"], Kyrgyzstan: ["🇰🇬", "KGZ"], Tajikistan: ["🇹🇯", "TJK"], Turkmenistan: ["🇹🇲", "TKM"], Belarus: ["🇧🇾", "BLR"], Ukraine: ["🇺🇦", "UKR"], Azerbaijan: ["🇦🇿", "AZE"], Georgia: ["🇬🇪", "GEO"], Montenegro: ["🇲🇪", "MNE"], Serbia: ["🇷🇸", "SRB"], Italy: ["🇮🇹", "ITA"], Brazil: ["🇧🇷", "BRA"], Nigeria: ["🇳🇬", "NGA"], Ghana: ["🇬🇭", "GHA"], Cameroon: ["🇨🇲", "CMR"], Senegal: ["🇸🇳", "SEN"], Mali: ["🇲🇱", "MLI"], "Côte d’Ivoire": ["🇨🇮", "CIV"], "Cote d'Ivoire": ["🇨🇮", "CIV"],
  };
  if (!primary) return { flag: "", code: "—" };
  const known = countries[primary];
  return known ? { flag: known[0], code: known[1] } : { flag: "", code: primary.slice(0, 3).toUpperCase() };
}
export function formatPercentage(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${Number(value.toFixed(1))}%`;
}
export function formatEventType(type: string) {
  const labels: Record<string, string> = {
    CLUB_NEED_DECREASED: "Club need decreased", CLUB_NEED_INCREASED: "Club need increased",
    OPPORTUNITY_SCORE_INCREASED: "Opportunity score increased", OPPORTUNITY_SCORE_DECREASED: "Opportunity score decreased",
    AGENCY_CHANGED: "Agency changed", REPRESENTATION_STATUS_CHANGED: "Representation changed",
    CONTRACT_CHANGED: "Contract changed", MARKET_VALUE_CHANGED: "Market value changed", CLUB_CHANGED: "Club changed",
    PLAYER_LEFT_CLUB: "Player left club", PLAYER_JOINED_CLUB: "Player joined club",
  };
  return labels[type] ?? type.split("_").map(word => word[0] + word.slice(1).toLowerCase()).join(" ");
}
