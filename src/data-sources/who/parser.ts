import type { EventCandidateInput } from "@/types/events";
import { findCountryByName, getCountry } from "@/lib/geo/gazetteer";
import { plainText, type ParseContext, type ParseResult } from "../types";
import type { WhoDonResponse } from "./types";

const MAX_AGE_DAYS = 45;
const ALIASES: Record<string, string> = {
  "democratic republic of the congo": "CD", "united republic of tanzania": "TZ", "republic of korea": "KR", "viet nam": "VN",
  "lao people's democratic republic": "LA", "russian federation": "RU", "iran (islamic republic of)": "IR", "syrian arab republic": "SY",
  "bolivia (plurinational state of)": "BO", "venezuela (bolivarian republic of)": "VE", "united kingdom of great britain and northern ireland": "GB",
  "united states of america": "US", "türkiye": "TR", "côte d'ivoire": "CI", "republic of moldova": "MD", "kingdom of saudi arabia": "SA",
};

/** WHO titles end with the affected country/countries: "Ebola disease … - Democratic Republic of the Congo". */
export function countriesFromTitle(title: string) {
  const tail = title.split(/\s[-–]\s/).pop() ?? "";
  return tail
    .split(/,|\band\b/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => (ALIASES[p.toLowerCase()] ? getCountry(ALIASES[p.toLowerCase()]) : findCountryByName(p)))
    .filter((c): c is NonNullable<typeof c> => !!c);
}

export function parseWho(res: WhoDonResponse, ctx: ParseContext): ParseResult {
  const candidates: EventCandidateInput[] = [];
  let skipped = 0;
  for (const item of res.value ?? []) {
    const title = plainText(item.OverrideTitle || item.Title, 250);
    const published = new Date(item.PublicationDate);
    const countries = countriesFromTitle(title);
    if (!countries.length || ctx.now - published.getTime() > MAX_AGE_DAYS * 86_400_000) {
      skipped++;
      continue;
    }
    const main = countries[0];
    const overview = plainText(item.Summary || item.Overview, 1500);
    candidates.push({
      type: "HEALTH",
      subtype: "disease-outbreak",
      title,
      summary: `The World Health Organization published a Disease Outbreak News report (${item.DonId}) on ${published.toISOString().slice(0, 10)}: ${title}.`,
      description: overview || null,
      latitude: main.label[1],
      longitude: main.label[0],
      geoPrecision: "country",
      locationName: countries.map((c) => c.name).join(", "),
      country: main.code,
      timestamp: published.toISOString(),
      metrics: { don_id: item.DonId, countries: countries.length },
      entities: [{ type: "ORGANIZATION", name: "World Health Organization", code: "WHO" }, ...countries.map((c) => ({ type: "COUNTRY" as const, name: c.name, code: c.code }))],
      source: {
        id: `who:${item.DonId}`,
        dataSourceId: "who",
        externalId: item.DonId,
        sourceName: "World Health Organization — Disease Outbreak News",
        sourceUrl: `https://www.who.int/emergencies/disease-outbreak-news/item/${encodeURIComponent(item.UrlName)}`,
        title,
        titleIsDerived: false,
        publishedAt: published.toISOString(),
        retrievedAt: ctx.retrievedAt,
        sourceType: "OFFICIAL_AGENCY",
        assertion: "OFFICIAL_FINAL",
        credibility: { basis: "World Health Organization (UN specialised agency)" },
      },
      rawData: { DonId: item.DonId, Title: item.Title, PublicationDate: item.PublicationDate },
    });
  }
  return { candidates, skipped };
}
