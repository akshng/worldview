/**
 * GeoNet (New Zealand) felt earthquakes: the keyless quake API filtered to MMI ≥ 3
 * (weak shaking and above). Times are UTC. Deleted solutions are skipped; "best"
 * (reviewed) solutions are final, automatic/preliminary ones are preliminary.
 * GeoNet volcanic alert levels are not ingested: that feed has no issue time.
 */
import type { EventCandidateInput } from "@/types/events";
import { httpGet, type DataSourceConnector, type FetchContext, type ParseContext, type ParseResult } from "../types";
import { magnitudeOf, quakeCandidate, validLatLon } from "../quake-common";

export interface GeonetFeature {
  geometry?: { type: string; coordinates?: [number, number] } | null;
  properties?: { publicID?: string; time?: string; depth?: number; magnitude?: number; mmi?: number; locality?: string; quality?: string };
}
export interface GeonetRaw {
  features: GeonetFeature[];
}

const WINDOW_MS = 7 * 86_400_000;

export async function fetchGeonet(ctx: FetchContext): Promise<GeonetRaw> {
  const res = await httpGet("https://api.geonet.org.nz/quake?MMI=3", ctx, { accept: "application/vnd.geo+json;version=2" });
  return (await res.json()) as GeonetRaw;
}

export function parseGeonet(raw: GeonetRaw, ctx: ParseContext): ParseResult {
  const candidates: EventCandidateInput[] = [];
  let skipped = 0;
  for (const f of raw.features ?? []) {
    const p = f.properties ?? {};
    const [lon, lat] = f.geometry?.coordinates ?? [NaN, NaN];
    const when = p.time ? new Date(p.time) : null;
    if (!p.publicID || !when || Number.isNaN(when.getTime()) || !validLatLon(lat, lon) || p.quality === "deleted" || ctx.now - when.getTime() > WINDOW_MS) {
      skipped++;
      continue;
    }
    const place = p.locality?.trim() || null;
    candidates.push(
      quakeCandidate({
        dataSourceId: "geonet",
        externalId: p.publicID,
        sourceName: "GeoNet — Earth Sciences New Zealand",
        agency: "GeoNet",
        sourceUrl: `https://www.geonet.org.nz/earthquake/${encodeURIComponent(p.publicID)}`,
        credibilityBasis: "New Zealand's national geological hazard monitoring system (GeoNet)",
        assertion: p.quality === "best" ? "OFFICIAL_FINAL" : "OFFICIAL_PRELIMINARY",
        when,
        retrievedAt: ctx.retrievedAt,
        latitude: lat,
        longitude: lon,
        magnitude: magnitudeOf(p.magnitude),
        depthKm: typeof p.depth === "number" ? p.depth : null,
        place: place ? `${place}, New Zealand` : null,
        extraSummary: typeof p.mmi === "number" ? `Estimated maximum shaking MMI ${p.mmi}.` : undefined,
        extraMetrics: { mmi: typeof p.mmi === "number" ? p.mmi : null, quality: p.quality ?? null },
        rawData: p,
      }),
    );
  }
  return { candidates, skipped };
}

export const geonetConnector: DataSourceConnector<GeonetRaw> = {
  id: "geonet",
  name: "GeoNet earthquakes (New Zealand)",
  description: "Earthquakes felt in New Zealand (modelled shaking MMI 3+) in the past 7 days, from GeoNet. Includes many quakes below the USGS/EMSC thresholds.",
  homepage: "https://www.geonet.org.nz/earthquake",
  attribution: "GeoNet — CC BY 4.0; attribute GeoNet and its sponsors (EQC, Earth Sciences New Zealand, LINZ)",
  sourceType: "OFFICIAL_AGENCY",
  categories: ["EARTHQUAKE"],
  refreshIntervalMs: 5 * 60_000,
  mode: "live",
  fetch: fetchGeonet,
  parse: parseGeonet,
};
