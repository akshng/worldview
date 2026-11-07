/**
 * Instituto Geográfico Nacional (Spain) earthquake GeoRSS (keyless): earthquakes of the last
 * ten days in and around the Iberian Peninsula, the Canary Islands and the Alboran Sea, as
 * reported by Spain's national seismic network. Each item carries `geo:lat`/`geo:long`; the
 * magnitude and the place come from the Spanish description ("Se ha producido un terremoto de
 * magnitud 2.6 en ALBORÁN NORTE en la fecha 06/11/2026 8:09:09 …"); the time is UTC (it
 * matches the EMSC copy of the same IGN solution). The feed gives no depth.
 * Events of the last 3 days at M2.5+ are kept; dedup merges them with EMSC/USGS.
 */
import type { EventCandidateInput } from "@/types/events";
import { httpGet, plainText, safeUrl, type DataSourceConnector, type FetchContext, type ParseContext, type ParseResult } from "../types";
import { quakeCandidate, validLatLon } from "../quake-common";

export interface IgnItem {
  title: string;
  link: string;
  description: string;
  lat: string;
  lon: string;
}
export interface IgnRaw {
  items: IgnItem[];
}

export const IGN_MIN_MAG = 2.5;
const MAX_AGE_MS = 3 * 86_400_000;
const FEED_URL = "https://www.ign.es/ign/RssTools/sismologia.xml";

const tag = (block: string, name: string) => {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  return m ? m[1].replace(/^<!\[CDATA\[|\]\]>$/g, "").trim() : "";
};

export function readIgnXml(xml: string): IgnItem[] {
  return [...(xml ?? "").matchAll(/<item>([\s\S]*?)<\/item>/gi)].map(([, b]) => ({
    title: tag(b, "title"),
    link: tag(b, "link"),
    description: tag(b, "description"),
    lat: tag(b, "geo:lat"),
    lon: tag(b, "geo:long"),
  }));
}

export async function fetchIgn(ctx: FetchContext): Promise<IgnRaw> {
  const res = await httpGet(FEED_URL, ctx, { accept: "application/rss+xml, application/xml, text/xml" });
  return { items: readIgnXml(await res.text()) };
}

/** "06/11/2026 8:09:09" (UTC) → ms epoch, else NaN. */
export function ignTime(s: string): number {
  const m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})/);
  return m ? Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1]), Number(m[4]), Number(m[5]), Number(m[6])) : NaN;
}

export function parseIgn(raw: IgnRaw, ctx: ParseContext): ParseResult {
  const candidates: EventCandidateInput[] = [];
  let skipped = 0;
  const seen = new Set<string>();
  for (const it of raw.items ?? []) {
    const desc = plainText(it.description, 600);
    const lat = Number.parseFloat(it.lat), lon = Number.parseFloat(it.lon);
    const mag = Number.parseFloat(desc.match(/magnitud\s+(\d+(?:[.,]\d+)?)/i)?.[1]?.replace(",", ".") ?? "");
    const place = desc.match(/magnitud\s+[\d.,]+\s+en\s+(.+?)\s+en la fecha/i)?.[1]?.trim() ?? null;
    const t = ignTime(desc.match(/en la fecha\s+([\d/]+\s+[\d:]+)/i)?.[1] ?? it.title);
    const id = it.link.match(/evid=([A-Za-z0-9]+)/)?.[1];
    if (!id || seen.has(id) || !validLatLon(lat, lon) || !Number.isFinite(mag) || mag < IGN_MIN_MAG || Number.isNaN(t) || ctx.now - t > MAX_AGE_MS || t > ctx.now + 3_600_000) {
      skipped++;
      continue;
    }
    seen.add(id);
    candidates.push(
      quakeCandidate({
        dataSourceId: "ign-spain",
        externalId: id,
        sourceName: "Instituto Geográfico Nacional (Spain) — Red Sísmica Nacional",
        agency: "IGN Spain",
        sourceUrl: safeUrl(it.link.replace(/^http:/, "https:")),
        credibilityBasis: "Spain's national seismic network (Instituto Geográfico Nacional)",
        assertion: "OFFICIAL_PRELIMINARY",
        when: new Date(t),
        retrievedAt: ctx.retrievedAt,
        latitude: lat,
        longitude: lon,
        magnitude: Math.round(mag * 10) / 10,
        depthKm: null,
        place,
        rawData: { id, title: it.title },
      }),
    );
  }
  return { candidates, skipped };
}

export const ignSpainConnector: DataSourceConnector<IgnRaw> = {
  id: "ign-spain",
  name: "IGN Spain earthquakes",
  description: "Magnitude 2.5+ earthquakes in Spain, Portugal, the Alboran Sea and the Canaries from Spain's Instituto Geográfico Nacional (past 3 days); merged with EMSC/USGS records of the same quake.",
  homepage: "https://www.ign.es/web/ign/portal/sis-catalogo-terremotos",
  attribution: "Instituto Geográfico Nacional (IGN), Spain — reuse permitted with attribution (CC BY 4.0, ign.es)",
  sourceType: "OFFICIAL_AGENCY",
  categories: ["EARTHQUAKE"],
  refreshIntervalMs: 10 * 60_000,
  mode: "live",
  fetch: fetchIgn,
  parse: parseIgn,
};
