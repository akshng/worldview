/** CDC Travelers' Health notices (public RSS): outbreaks and health risks by destination. */
import type { EventCandidateInput } from "@/types/events";
import { findCountryByName } from "@/lib/geo/gazetteer";
import { placesInText } from "@/lib/geo/headline-places";
import { parseFeedXml } from "../news-rss/client";
import { httpGet, plainText, safeUrl, type DataSourceConnector, type FetchContext, type ParseContext, type ParseResult } from "../types";
import type { RssItem } from "../news-rss/types";

export interface CdcRaw {
  items: RssItem[];
}

const MAX_AGE_MS = 120 * 86_400_000;
const LEVELS: Record<number, string> = { 1: "Practice usual precautions", 2: "Practice enhanced precautions", 3: "Reconsider nonessential travel", 4: "Avoid nonessential travel" };

export async function fetchCdcTravel(ctx: FetchContext): Promise<CdcRaw> {
  return { items: parseFeedXml(await (await httpGet("https://wwwnc.cdc.gov/travel/rss/notices.xml", ctx, { accept: "application/rss+xml, application/xml" })).text()) };
}

/** "Level 2 - Yellow Fever in Colombia" → { level, topic, place } */
export function splitCdcTitle(title: string): { level: number | null; topic: string; place: string | null } {
  const m = title.match(/^Level\s+(\d)\s*[-–]\s*(.*)$/i);
  const rest = m ? m[2] : title;
  const inMatch = rest.match(/^(.*)\s+in\s+(.+)$/i);
  return { level: m ? Number(m[1]) : null, topic: (inMatch ? inMatch[1] : rest).trim(), place: inMatch ? inMatch[2].trim() : null };
}

export function parseCdcTravel(raw: CdcRaw, ctx: ParseContext): ParseResult {
  const candidates: EventCandidateInput[] = [];
  let skipped = 0;
  for (const it of raw.items ?? []) {
    const published = it.published ? new Date(it.published) : null;
    const { level, topic, place } = splitCdcTitle(it.title);
    // "Global Dengue" etc. have no single place — skipped rather than pinned somewhere arbitrary.
    const country = place ? (findCountryByName(place) ?? placesInText(place)[0]?.country) : undefined;
    if (!published || Number.isNaN(published.getTime()) || ctx.now - published.getTime() > MAX_AGE_MS || !country || !place) {
      skipped++;
      continue;
    }
    const link = safeUrl(it.link);
    const id = (link ?? it.title).replace(/^https?:\/\/[^/]+/, "").replace(/[^a-z0-9/-]/gi, "").slice(-80);
    const [lon, lat] = country.label;
    candidates.push({
      type: "HEALTH",
      subtype: "disease",
      title: `${topic} in ${place}${level ? ` — CDC travel notice level ${level}` : ""}`,
      summary:
        `The U.S. CDC issued a travel health notice for ${place}${level ? ` at level ${level} (${LEVELS[level]})` : ""} on ${published.toISOString().slice(0, 10)}.` +
        (it.description ? ` ${plainText(it.description, 300)}` : ""),
      latitude: lat,
      longitude: lon,
      geoPrecision: "country",
      locationName: country.name,
      country: country.code,
      timestamp: published.toISOString(),
      metrics: { travel_notice_level: level, disease: topic },
      entities: [{ type: "ORGANIZATION", name: "U.S. Centers for Disease Control and Prevention", code: "CDC" }, { type: "COUNTRY", name: country.name, code: country.code }],
      source: {
        id: `cdc-travel:${id}`,
        dataSourceId: "cdc-travel",
        externalId: id,
        sourceName: "CDC Travelers' Health",
        sourceUrl: link,
        title: it.title,
        titleIsDerived: false,
        publishedAt: published.toISOString(),
        retrievedAt: ctx.retrievedAt,
        sourceType: "OFFICIAL_AGENCY",
        assertion: "OFFICIAL_FINAL",
        credibility: { basis: "U.S. federal public-health agency (CDC)" },
      },
      rawData: { title: it.title, link: it.link, published: it.published },
    });
  }
  return { candidates, skipped };
}

export const cdcTravelConnector: DataSourceConnector<CdcRaw> = {
  id: "cdc-travel",
  name: "CDC travel health notices",
  description: "Disease outbreaks and health risks by destination from the U.S. CDC Travelers' Health notices (global notices without one country are not mapped).",
  homepage: "https://wwwnc.cdc.gov/travel/notices",
  attribution: "U.S. Centers for Disease Control and Prevention — public domain",
  sourceType: "OFFICIAL_AGENCY",
  categories: ["HEALTH"],
  refreshIntervalMs: 6 * 60 * 60_000,
  mode: "live",
  fetch: fetchCdcTravel,
  parse: parseCdcTravel,
};
