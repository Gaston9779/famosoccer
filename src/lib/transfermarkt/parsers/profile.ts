import * as cheerio from "cheerio";
import {
  marketValue,
  normalizePosition,
  normalizeRepresentation,
  parseDate,
} from "../../normalization";
import { ProviderError } from "../errors";
export function parseProfile(html: string, id: string, url: string) {
  const $ = cheerio.load(html);
  const clean = (s: string) => s.replace(/\s+/g, " ").trim();
  const fields = new Map<string, string>();
  $(".info-table__content--regular").each((_, el) => {
    fields.set(
      clean($(el).text()).replace(/:$/, "").toLowerCase(),
      clean($(el).next(".info-table__content--bold").text()),
    );
  });
  $("th").each((_, el) => {
    fields.set(
      clean($(el).text()).replace(/:$/, "").toLowerCase(),
      clean($(el).next("td").text()),
    );
  });
  const field = (...labels: string[]) => {
    for (const l of labels) if (fields.has(l)) return fields.get(l)!;
    return null;
  };
  const heading = $("h1.data-header__headline-wrapper, h1").first().clone();
  heading.find(".data-header__shirt-number").remove();
  const name = clean(heading.text());
  if (!name || !fields.size || /access denied|error|captcha/i.test(name))
    throw new ProviderError(
      "PROFILE_PARSE",
      "Essential profile structure/name missing; profile was not imported.",
    );
  const canonical = $('link[rel="canonical"]').attr("href") ?? url;
  const portrait = $(".data-header__profile-image img, img.data-header__profile-image").first();
  const portraitCandidates = [
    portrait.attr("data-src"),
    portrait.attr("src"),
    portrait.attr("data-srcset"),
    portrait.attr("srcset"),
  ].filter((value): value is string => !!value);
  const portraitUrl = portraitCandidates
    .flatMap((value) => value.split(",").map((entry) => entry.trim().split(/\s+/)[0]))
    .find((value) => /(?:portrait|spieler|player)/i.test(value) && !/placeholder/i.test(value)) ?? null;
  const canonicalId = canonical.match(/\/spieler\/(\d+)/)?.[1];
  if (canonicalId && canonicalId !== id)
    throw new ProviderError(
      "PROFILE_PARSE",
      "Profile player ID does not match requested ID",
    );
  const birthRaw = field(
    "date of birth/age",
    "date of birth",
    "geb./alter",
    "geburtsdatum",
    "data di nascita/età",
    "data di nascita",
  );
  const agentRaw = field(
    "player agent",
    "agent",
    "berater",
    "spielerberater",
    "agente",
  );
  const mainPosition =
    field("position", "position:", "posizione") ??
    (clean($(".detail-position__position").first().text()) || null);
  const clubLink = $(
    '.data-header__club a[href*="/verein/"], .data-header__club-info a[href*="/verein/"]',
  ).first();
  const clubId = clubLink.attr("href")?.match(/\/verein\/(\d+)/)?.[1] ?? null;
  const rawValue =
    clean(
      $(".data-header__market-value-wrapper")
        .first()
        .clone()
        .find("p")
        .remove()
        .end()
        .text(),
    ) || null;
  const heightRaw = field("height", "größe", "altezza");
  const height = heightRaw?.match(/^(\d)[.,](\d{2})\s*m$/);
  const nationalityRaw = field(
    "citizenship",
    "nationality",
    "staatsbürgerschaft",
    "nazionalità",
  );
  const nationalities: string[] = [];
  $(".info-table__content--regular").each((_, el) => {
    if (
      /citizenship|nationality|staatsbürgerschaft|nazionalità/i.test(
        $(el).text(),
      )
    )
      $(el)
        .next()
        .find("img[title]")
        .each((_, img) => {
          const n = $(img).attr("title");
          if (n && !nationalities.includes(n)) nationalities.push(n);
        });
  });
  if (!nationalities.length && nationalityRaw)
    nationalities.push(nationalityRaw);
  const secondary = $("dd.detail-position__position")
    .slice(1)
    .map((_, el) => clean($(el).text()))
    .get();
  return {
    tmPlayerId: id,
    tmUrl: canonical,
    portraitUrl,
    name,
    birthDate: parseDate(birthRaw),
    age: birthRaw?.match(/\((\d+)\)/)
      ? Number(birthRaw.match(/\((\d+)\)/)![1])
      : null,
    birthPlace: field("place of birth", "geburtsort", "luogo di nascita"),
    nationalities: JSON.stringify(nationalities),
    heightCm: height ? Number(height[1]) * 100 + Number(height[2]) : null,
    preferredFoot: field("foot", "fuß", "piede"),
    mainPosition,
    positionGroup: normalizePosition(mainPosition),
    secondaryPositions: secondary.length ? JSON.stringify(secondary) : null,
    shirtNumber:
      clean($(".data-header__shirt-number").first().text()).replace(/^#/, "") ||
      null,
    joinedDate: parseDate(field("joined", "im team seit", "in rosa da")),
    contractExpires: parseDate(
      field("contract expires", "vertrag bis", "scadenza"),
    ),
    contractOption: field(
      "contract option",
      "vertragsoption",
      "opzione contratto",
    ),
    agentRaw,
    ...normalizeRepresentation(agentRaw),
    marketValueRaw: rawValue,
    marketValueEur: marketValue(rawValue),
    currentClub: clubId
      ? {
          tmClubId: clubId,
          name: clean(clubLink.text()) || clubLink.attr("title") || null,
          tmUrl: clubLink.attr("href") ?? null,
        }
      : null,
  };
}
