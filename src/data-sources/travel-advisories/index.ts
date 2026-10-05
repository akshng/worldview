/** U.S. State Department travel advisories (public RSS). Advisories updated in the last 30 days. */
import type { EventCandidateInput } from "@/types/events";
import { findCountryByName } from "@/lib/geo/gazetteer";
import { placesInText } from "@/lib/geo/headline-places";
import { parseFeedXml } from "../news-rss/client";
import { httpGet, plainText, safeUrl, type DataSourceConnector, type FetchContext, type ParseContext, type ParseResult } from "../types";
import type { RssItem } from "../news-rss/types";

export interface TravelRaw {
  items: RssItem[];
}

const MAX_AGE_MS = 30 * 86_400_000;
const LEVELS: Record<number, string> = { 1: "Exercise normal precautions", 2: "Exercise increased caution", 3: "Reconsider travel", 4: "Do not travel" };

export async function fetchTravelAdvisories(ctx: FetchContext): Promise<TravelRaw> {
  return { items: parseFeedXml(await (await httpGet("https://travel.state.gov/_res/rss/TAsTWs.xml", ctx, { accept: "application/rss+xml, application/xml" })).text()) };
}

/** "Saudi Arabia - Level 3: Reconsider Travel" → { place, level } */
export function splitAdvisoryTitle(title: string): { place: string; level: number | null } {
  const m = title.match(/^(.*?)\s+[-–]\s+Level\s+(\d)\b/i);
  return m ? { place: m[1].trim(), level: Number(m[2]) } : { place: title.split(" - ")[0].trim(), level: null };
}

export function parseTravelAdvisories(raw: TravelRaw, ctx: ParseContext): ParseResult {
  const candidates: EventCandidateInput[] = [];
  let skipped = 0;
  for (const it of raw.items ?? []) {
    const published = it.published ? new Date(it.published) : null;
    const { place, level } = splitAdvisoryTitle(it.title);
    if (!published || Number.isNaN(published.getTime()) || ctx.now - published.getTime() > MAX_AGE_MS || !level || level < 2) {
      skipped++;
      continue;
    }
    const country = findCountryByName(place) ?? placesInText(place)[0]?.country;
    if (!country) {
      skipped++;
      continue;
    }
    const [lon, lat] = country.label;
    const reason = plainText(it.description, 400).replace(/\s*Read the entire Travel Advisory\.?.*$/i, "").replace(/\s+([.,;:])/g, "$1");
    candidates.push({
      type: "POLITICS",
      subtype: "travel advisory",
      title: `US travel advisory: ${place} — Level ${level}, ${LEVELS[level]?.toLowerCase() ?? ""}`.trim(),
      summary: `The U.S. Department of State updated its travel advisory for ${place} on ${published.toISOString().slice(0, 10)}: Level ${level} (${LEVELS[level]}).`,
      description: reason || null,
      latitude: lat,
      longitude: lon,
      geoPrecision: "country",
      locationName: country.name,
      country: country.code,
      timestamp: published.toISOString(),
      metrics: { advisory_level: level },
      entities: [{ type: "ORGANIZATION", name: "U.S. Department of State", code: null }, { type: "COUNTRY", name: country.name, code: country.code }],
      source: {
        // One record per country and level; a level change supersedes the old one.
        id: `travel-advisories:${country.code}:${level}`,
        dataSourceId: "travel-advisories",
        externalId: `${country.code}:${level}`,
        sourceName: "U.S. Department of State — Travel Advisories",
        sourceUrl: safeUrl(it.link),
        title: it.title,
        titleIsDerived: false,
        publishedAt: published.toISOString(),
        retrievedAt: ctx.retrievedAt,
        sourceType: "OFFICIAL_AGENCY",
        assertion: "OFFICIAL_FINAL",
        credibility: { basis: "U.S. federal government (Department of State)" },
      },
      supersedes: [1, 2, 3, 4].filter((l) => l !== level).map((l) => `travel-advisories:${country.code}:${l}`),
      rawData: { title: it.title, link: it.link, published: it.published },
    });
  }
  return { candidates, skipped };
}

export const travelAdvisoriesConnector: DataSourceConnector<TravelRaw> = {
  id: "travel-advisories",
  name: "US travel advisories",
  description: "U.S. State Department travel advisories at level 2–4 (increased caution, reconsider travel, do not travel) updated in the last 30 days.",
  homepage: "https://travel.state.gov/content/travel/en/traveladvisories/traveladvisories.html",
  attribution: "U.S. Department of State — public domain",
  sourceType: "OFFICIAL_AGENCY",
  categories: ["POLITICS"],
  refreshIntervalMs: 6 * 60 * 60_000,
  mode: "live",
  fetch: fetchTravelAdvisories,
  parse: parseTravelAdvisories,
};
