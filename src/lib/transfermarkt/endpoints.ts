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
export const endpoints = {
  teams: "/quickselect/teams/UZ1",
  players: (id: string) => `/quickselect/players/${id}`,
  performance: (id: string) => `/ceapi/player/${id}/performance`,
  profile: (id: string) => `/player/profil/spieler/${id}`,
};
