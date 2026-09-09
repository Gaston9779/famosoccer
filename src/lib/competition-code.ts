type Competition = { tmCompetitionId: string; name: string; country: string } | null | undefined;

const countryCodes: Record<string, string> = {
  Uzbekistan: "UZB", Kazakhstan: "KAZ", Tajikistan: "TJK", Iran: "IRN",
  Italy: "ITA", Germany: "GER", Georgia: "GEO", Kyrgyzstan: "KGZ",
  Russia: "RUS", Ukraine: "UKR", Belarus: "BLR", Azerbaijan: "AZE",
};

/** A display-only code derived from persisted competition metadata. */
export function formatCompetitionShortCode(competition: Competition): string | null {
  if (!competition) return null;
  const country = countryCodes[competition.country];
  if (!country) return null;
  if (competition.tmCompetitionId === "UZ1") return "UZB1";
  const text = `${competition.name} ${competition.tmCompetitionId}`.toLowerCase();
  const tier = /(?:\b(?:pro liga|second division|serie b|2\. bundesliga|regionalliga)\b|(?:^|\D)2(?:\D|$))/.test(text) ? 2
    : /(?:\b(?:fourth division|regionalliga)\b|(?:^|\D)4(?:\D|$))/.test(text) ? 4
    : /(?:\b(?:super league|premier league|first division|serie a|bundesliga)\b|(?:^|\D)1(?:\D|$))/.test(text) ? 1
    : null;
  return tier ? `${country}${tier}` : `${country}?`;
}
