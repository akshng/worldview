/**
 * Japan Meteorological Agency earthquake bulletins (keyless JSON behind jma.go.jp/bosai).
 * The list holds every bulletin of the past ~30 days; several bulletins share an event id
 * (intensity flash, hypocentre, hypocentre + intensity). One event per id: location and
 * magnitude from the newest bulletin that has a hypocentre, maximum JMA seismic intensity
 * (shindo) across all of them. Times carry +09:00 (JST) and are converted to UTC.
 */
import type { EventCandidateInput } from "@/types/events";
import { httpGet, type DataSourceConnector, type FetchContext, type ParseContext, type ParseResult } from "../types";
import { magnitudeOf, quakeCandidate, validLatLon } from "../quake-common";

export interface JmaQuakeItem {
  ctt?: string; // bulletin creation time, JST yyyymmddhhmmss
  eid?: string; // event id
  rdt?: string; // report time, ISO with +09:00
  ttl?: string;
  en_ttl?: string;
  at?: string; // origin time, ISO with +09:00
  anm?: string;
  en_anm?: string;
  cod?: string; // ISO 6709: "+27.3+128.9-30000/" (lat, lon, altitude in m)
  mag?: string;
  maxi?: string; // maximum seismic intensity: "1".."4", "5-", "5+", "6-", "6+", "7"
}

const WINDOW_MS = 7 * 86_400_000;
const SHINDO_ORDER = ["1", "2", "3", "4", "5-", "5+", "6-", "6+", "7"];
const SHINDO_TEXT: Record<string, string> = { "5-": "5 Lower", "5+": "5 Upper", "6-": "6 Lower", "6+": "6 Upper" };

export async function fetchJmaQuake(ctx: FetchContext): Promise<JmaQuakeItem[]> {
  const res = await httpGet("https://www.jma.go.jp/bosai/quake/data/list.json", ctx);
  return (await res.json()) as JmaQuakeItem[];
}

/** "+35.8+140.7-50000/" → { lat: 35.8, lon: 140.7, depthKm: 50 } */
export function parseIso6709(cod: string | undefined): { lat: number; lon: number; depthKm: number | null } | null {
  const m = /^([+-]\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)?\/?$/.exec((cod ?? "").trim());
  if (!m) return null;
  const lat = Number(m[1]), lon = Number(m[2]);
  if (!validLatLon(lat, lon)) return null;
  return { lat, lon, depthKm: m[3] !== undefined ? Math.abs(Number(m[3])) / 1000 : null };
}

const shindoRank = (s: string | undefined) => SHINDO_ORDER.indexOf((s ?? "").trim());

export function parseJmaQuake(raw: JmaQuakeItem[], ctx: ParseContext): ParseResult {
  const byEvent = new Map<string, JmaQuakeItem[]>();
  for (const it of raw ?? []) {
    if (!it?.eid) continue;
    byEvent.set(it.eid, [...(byEvent.get(it.eid) ?? []), it]);
  }
  const candidates: EventCandidateInput[] = [];
  let skipped = 0;
  for (const [eid, items] of byEvent) {
    const newestFirst = [...items].sort((a, b) => (b.ctt ?? "").localeCompare(a.ctt ?? ""));
    const main = newestFirst.find((i) => parseIso6709(i.cod) && i.at && !Number.isNaN(Date.parse(i.at)));
    if (!main) {
      skipped++; // intensity flash only, or an explanatory bulletin — no hypocentre yet
      continue;
    }
    const when = new Date(main.at!);
    if (ctx.now - when.getTime() > WINDOW_MS) {
      skipped++;
      continue;
    }
    const pos = parseIso6709(main.cod)!;
    const maxi = items.map((i) => i.maxi).reduce<string | undefined>((best, s) => (shindoRank(s) > shindoRank(best) ? s : best), undefined);
    const shindo = maxi && shindoRank(maxi) >= 0 ? (SHINDO_TEXT[maxi] ?? maxi) : null;
    const place = (main.en_anm || main.anm || "").replace(/\s+/g, " ").trim() || null;
    candidates.push(
      quakeCandidate({
        dataSourceId: "jma-quake",
        externalId: eid,
        sourceName: "Japan Meteorological Agency (JMA) — earthquake information",
        agency: "Japan Meteorological Agency",
        sourceUrl: `https://www.data.jma.go.jp/multi/quake/quake_detail.html?eventID=${encodeURIComponent(eid)}&lang=en`,
        credibilityBasis: "Japanese national meteorological and seismological agency",
        assertion: "OFFICIAL_PRELIMINARY",
        when,
        publishedAt: main.rdt && !Number.isNaN(Date.parse(main.rdt)) ? new Date(main.rdt) : when,
        retrievedAt: ctx.retrievedAt,
        latitude: pos.lat,
        longitude: pos.lon,
        magnitude: magnitudeOf(main.mag),
        magnitudeType: null,
        depthKm: pos.depthKm,
        place,
        extraSummary: shindo ? `Maximum JMA seismic intensity: ${shindo}.` : undefined,
        extraMetrics: { jma_max_intensity: shindo },
        rawData: { eid, ctt: main.ctt, ttl: main.en_ttl ?? main.ttl, cod: main.cod, maxi },
      }),
    );
  }
  return { candidates, skipped };
}

export const jmaQuakeConnector: DataSourceConnector<JmaQuakeItem[]> = {
  id: "jma-quake",
  name: "JMA earthquakes (Japan)",
  description: "Earthquakes reported by the Japan Meteorological Agency in the past 7 days, with the maximum JMA seismic intensity (shindo). Mostly felt quakes in and around Japan, many below the USGS/EMSC thresholds.",
  homepage: "https://www.jma.go.jp/bosai/map.html#contents=earthquake_map&lang=en",
  attribution: "Japan Meteorological Agency — Public Data License (government standard terms of use), attribution required",
  sourceType: "OFFICIAL_AGENCY",
  categories: ["EARTHQUAKE"],
  refreshIntervalMs: 5 * 60_000,
  mode: "live",
  fetch: fetchJmaQuake,
  parse: parseJmaQuake,
};
