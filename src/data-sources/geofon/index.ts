/**
 * GFZ GEOFON earthquake catalogue (FDSN event web service, `format=text`, keyless): M4.5+ of
 * the past 3 days worldwide. A second global agency next to USGS and EMSC with independent
 * locations and magnitudes (often first for Indonesia, the Mediterranean and Central Asia);
 * the earthquake dedup rule merges the same quake across sources.
 */
import type { EventCandidateInput } from "@/types/events";
import { httpGet, type DataSourceConnector, type FetchContext, type ParseContext, type ParseResult } from "../types";
import { quakeCandidate, validLatLon } from "../quake-common";

export interface GeofonRaw {
  text: string;
}

export const MIN_MAG = 4.5;

export async function fetchGeofon(ctx: FetchContext): Promise<GeofonRaw> {
  const start = new Date(ctx.now - 3 * 86_400_000).toISOString().slice(0, 19);
  const res = await httpGet(`https://geofon.gfz.de/fdsnws/event/1/query?format=text&minmag=${MIN_MAG}&orderby=time&limit=500&starttime=${start}`, ctx, { accept: "text/plain" });
  return { text: res.status === 204 ? "" : await res.text() };
}

export function parseGeofon(raw: GeofonRaw, ctx: ParseContext): ParseResult {
  const candidates: EventCandidateInput[] = [];
  let skipped = 0;
  for (const line of (raw.text ?? "").split(/\r?\n/)) {
    if (!line.trim() || line.startsWith("#")) continue;
    // EventID|Time|Latitude|Longitude|Depth/km|Author|Catalog|Contributor|ContributorID|MagType|Magnitude|MagAuthor|EventLocationName|EventType
    const f = line.split("|");
    const [id, time, latS, lonS, depthS] = f;
    const magType = f[9]?.trim() || null;
    const mag = Number.parseFloat(f[10] ?? "");
    const place = f[12]?.trim() || null;
    const type = (f[13] ?? "").trim().toLowerCase();
    const lat = Number.parseFloat(latS), lon = Number.parseFloat(lonS);
    const t = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(time ?? "") ? time : `${time}Z`);
    if (!/^gfz\d{4}[a-z]{4}$/.test(id ?? "") || !validLatLon(lat, lon) || Number.isNaN(t) || !Number.isFinite(mag) || mag < MIN_MAG || (type && type !== "earthquake")) {
      skipped++;
      continue;
    }
    const depth = Number.parseFloat(depthS);
    const c = quakeCandidate({
        dataSourceId: "geofon",
        externalId: id,
        sourceName: "GFZ GEOFON (German Research Centre for Geosciences)",
        agency: "GFZ GEOFON",
        sourceUrl: `https://geofon.gfz.de/eqinfo/event.php?id=${id}`,
        credibilityBasis: "German Research Centre for Geosciences (GFZ) GEOFON global seismic network",
        assertion: "OFFICIAL_PRELIMINARY",
        when: new Date(t),
        retrievedAt: ctx.retrievedAt,
        latitude: lat,
        longitude: lon,
        magnitude: Math.round(mag * 10) / 10,
        magnitudeType: magType,
        depthKm: Number.isFinite(depth) ? depth : null,
        place,
        rawData: { id, time, magType },
    });
    // GEOFON is a research network (like EMSC), not a national agency.
    c.source.sourceType = "SCIENTIFIC";
    candidates.push(c);
  }
  return { candidates, skipped };
}

export const geofonConnector: DataSourceConnector<GeofonRaw> = {
  id: "geofon",
  name: "GFZ GEOFON earthquakes",
  description: "Magnitude 4.5+ earthquakes worldwide from GFZ GEOFON (past 3 days); merged with USGS/EMSC records of the same quake.",
  homepage: "https://geofon.gfz.de/eqinfo/",
  attribution: "GFZ German Research Centre for Geosciences — GEOFON; cite GEOFON / GFZ",
  sourceType: "SCIENTIFIC",
  categories: ["EARTHQUAKE"],
  refreshIntervalMs: 5 * 60_000,
  mode: "live",
  fetch: fetchGeofon,
  parse: parseGeofon,
};
