import { ProviderError } from "./errors";
const domains = new Set([
  "com",
  "it",
  "de",
  "co.uk",
  "fr",
  "es",
  "pt",
  "nl",
  "be",
  "at",
  "ch",
  "com.tr",
  "com.br",
  "us",
  "co.in",
  "co.za",
  "ru",
  "pl",
  "cz",
  "dk",
  "se",
  "no",
  "fi",
  "gr",
  "ro",
  "hu",
  "co.kr",
  "jp",
  "co.id",
  "com.ar",
  "cl",
  "co",
  "mx",
  "pe",
]);
export function playerUrl(input: string) {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new ProviderError(
      "INVALID_URL",
      "Enter a valid Transfermarkt player profile URL.",
    );
  }
  const host = url.hostname.replace(/^www\./, "");
  const match = url.pathname.match(/^\/([^/]+)\/profil\/spieler\/(\d+)\/?$/);
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.port ||
    !host.startsWith("transfermarkt.") ||
    !domains.has(host.slice("transfermarkt.".length)) ||
    !match ||
    !/^[1-9]\d*$/.test(match[2])
  )
    throw new ProviderError(
      "INVALID_URL",
      "Only genuine Transfermarkt player profile URLs are accepted.",
    );
  return {
    id: match[2],
    path: `/${match[1]}/profil/spieler/${match[2]}`,
    url: `https://www.transfermarkt.com/${match[1]}/profil/spieler/${match[2]}`,
  };
}

/** Derive the public performance page from the persisted canonical profile URL. */
export function performanceUrl(profileUrl: string) {
  const profile = playerUrl(profileUrl);
  return {
    id: profile.id,
    path: profile.path.replace("/profil/spieler/", "/leistungsdaten/spieler/"),
    url: profile.url.replace("/profil/spieler/", "/leistungsdaten/spieler/"),
  };
}

/** TM's Leistungsdaten web component requests this documented-in-bundle JSON resource. */
export function tmapiPerformanceUrl(playerId: string) {
  if (!/^[1-9]\d*$/.test(playerId))
    throw new ProviderError("INVALID_URL", "A numeric Transfermarkt player ID is required for performance data.");
  const path = `/player/${playerId}/performance-game`;
  return { path, url: `https://tmapi.transfermarkt.technology${path}` };
}
export const endpoints = {
  teams: "/quickselect/teams/UZ1",
  players: (id: string) => `/quickselect/players/${id}`,
  profile: (id: string) => `/player/profil/spieler/${id}`,
};
