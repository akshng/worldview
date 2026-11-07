/**
 * INGV (Istituto Nazionale di Geofisica e Vulcanologia) earthquake catalogue, FDSN event web
 * service, `format=text` (keyless). Italy and the surrounding seas (35–48° N, 6–19° E), M2.5+,
 * past 3 days. INGV is Italy's national seismic authority; its locations and local place names
 * ("3 km SW Floridia (SR)") are more precise than the global feeds, and EMSC is only ingested
 * from M3, so the smaller felt Italian quakes are new coverage. The earthquake dedup rule merges
 * the same quake with USGS/EMSC records.
 */
import type { EventCandidateInput } from "@/types/events";
import { httpGet, type DataSourceConnector, type FetchContext, type ParseContext, type ParseResult } from "../types";
import { quakeCandidate, validLatLon } from "../quake-common";

export interface IngvRaw {
  text: string;
}

export const INGV_MIN_MAG = 2.5;
const BOX = { minlat: 35, maxlat: 48, minlon: 6, maxlon: 19 };

/** One row of an FDSN `format=text` event list (column names from its header line). */
export interface FdsnRow {
  id: string;
  time: string;
  lat: number;
  lon: number;
  depthKm: number | null;
  magType: string | null;
  mag: number;
  place: string | null;
  eventType: string | null;
}

/** Parse an FDSN text event list; columns are located by the `#EventID|Time|…` header. */
export function readFdsnText(text: string): { rows: FdsnRow[]; bad: number } {
  const lines = (text ?? "").split(/\r?\n/);
  const header = lines.find((l) => l.startsWith("#"));
  const cols = (header ?? "#EventID|Time|Latitude|Longitude|Depth/km|Author|Catalog|Contributor|ContributorID|MagType|Magnitude|MagAuthor|EventLocationName|EventType")
    .slice(1)
    .split("|")
    .map((c) => c.trim().toLowerCase());
  const at = (name: string) => cols.indexOf(name);
  const iId = at("eventid"), iTime = at("time"), iLat = at("latitude"), iLon = at("longitude"), iDepth = cols.findIndex((c) => c.startsWith("depth"));
  const iMagType = at("magtype"), iMag = at("magnitude"), iPlace = at("eventlocationname"), iType = at("eventtype");
  const rows: FdsnRow[] = [];
  let bad = 0;
  for (const line of lines) {
    if (!line.trim() || line.startsWith("#")) continue;
    const f = line.split("|");
    const lat = Number.parseFloat(f[iLat]), lon = Number.parseFloat(f[iLon]), mag = Number.parseFloat(f[iMag] ?? "");
    const depth = iDepth >= 0 ? Number.parseFloat(f[iDepth]) : NaN;
    if (!f[iId]?.trim() || !f[iTime] || !validLatLon(lat, lon) || !Number.isFinite(mag)) {
      bad++;
      continue;
    }
    rows.push({
      id: f[iId].trim(),
      time: f[iTime].trim(),
      lat,
      lon,
      depthKm: Number.isFinite(depth) ? depth : null,
      magType: f[iMagType]?.trim() || null,
      mag: Math.round(mag * 10) / 10,
      place: (iPlace >= 0 ? f[iPlace]?.trim() : "") || null,
      eventType: (iType >= 0 ? f[iType]?.trim().toLowerCase() : "") || null,
    });
  }
  return { rows, bad };
}

/** FDSN times are UTC, with or without a trailing Z. */
export function fdsnTime(s: string): number {
  return Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s}Z`);
}

export async function fetchIngv(ctx: FetchContext): Promise<IngvRaw> {
  const start = new Date(ctx.now - 3 * 86_400_000).toISOString().slice(0, 19);
  const q = `format=text&minmag=${INGV_MIN_MAG}&orderby=time&limit=500&starttime=${start}&minlat=${BOX.minlat}&maxlat=${BOX.maxlat}&minlon=${BOX.minlon}&maxlon=${BOX.maxlon}`;
  const res = await httpGet(`https://webservices.ingv.it/fdsnws/event/1/query?${q}`, ctx, { accept: "text/plain" });
  return { text: res.status === 204 ? "" : await res.text() };
}

export function parseIngv(raw: IngvRaw, ctx: ParseContext): ParseResult {
  const candidates: EventCandidateInput[] = [];
  const { rows, bad } = readFdsnText(raw.text);
  let skipped = bad;
  for (const r of rows) {
    const t = fdsnTime(r.time);
    const inBox = r.lat >= BOX.minlat && r.lat <= BOX.maxlat && r.lon >= BOX.minlon && r.lon <= BOX.maxlon;
    if (!/^\d+$/.test(r.id) || Number.isNaN(t) || r.mag < INGV_MIN_MAG || !inBox || (r.eventType && r.eventType !== "earthquake")) {
      skipped++;
      continue;
    }
    candidates.push(
      quakeCandidate({
        dataSourceId: "ingv",
        externalId: r.id,
        sourceName: "INGV — Istituto Nazionale di Geofisica e Vulcanologia",
        agency: "INGV",
        sourceUrl: `https://terremoti.ingv.it/event/${r.id}`,
        credibilityBasis: "Italy's national institute of geophysics and volcanology (national seismic network)",
        assertion: "OFFICIAL_PRELIMINARY",
        when: new Date(t),
        retrievedAt: ctx.retrievedAt,
        latitude: r.lat,
        longitude: r.lon,
        magnitude: r.mag,
        magnitudeType: r.magType,
        depthKm: r.depthKm,
        place: r.place,
        rawData: { id: r.id, time: r.time, magType: r.magType },
      }),
    );
  }
  return { candidates, skipped };
}

export const ingvConnector: DataSourceConnector<IngvRaw> = {
  id: "ingv",
  name: "INGV Italy earthquakes",
  description: "Magnitude 2.5+ earthquakes in Italy and its seas from INGV, Italy's national seismic network (past 3 days); merged with USGS/EMSC records of the same quake.",
  homepage: "https://terremoti.ingv.it/",
  attribution: "INGV — Istituto Nazionale di Geofisica e Vulcanologia; data CC BY 4.0",
  sourceType: "OFFICIAL_AGENCY",
  categories: ["EARTHQUAKE"],
  refreshIntervalMs: 5 * 60_000,
  mode: "live",
  fetch: fetchIngv,
  parse: parseIngv,
};
