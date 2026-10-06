/**
 * Shared helpers for national seismological agencies' earthquake feeds
 * (JMA, BMKG, GeoNet, AFAD, SSN). Each agency's parser extracts the facts; this
 * builds the EventCandidate the same way EMSC/USGS do, so the earthquake dedup
 * rule (100 km, 3 min, magnitudes agree) merges the same quake across sources.
 */
import type { EventCandidateInput, EventMetrics, SourceAssertion } from "@/types/events";

export interface QuakeFacts {
  dataSourceId: string;
  externalId: string;
  /** Publisher, e.g. "Japan Meteorological Agency (JMA)" */
  sourceName: string;
  /** Short agency name used in the summary, e.g. "JMA" */
  agency: string;
  sourceUrl: string | null;
  credibilityBasis: string;
  assertion: SourceAssertion;
  when: Date;
  publishedAt?: Date | null;
  retrievedAt: string;
  latitude: number;
  longitude: number;
  magnitude: number | null;
  magnitudeType?: string | null;
  depthKm: number | null;
  place: string | null;
  country?: string | null;
  /** Appended to the generated summary */
  extraSummary?: string;
  extraMetrics?: EventMetrics;
  rawData?: unknown;
}

/** Numeric magnitude or null ("no calculable", "Ｍ不明", ""). */
export function magnitudeOf(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number.parseFloat(v.replace(/^[MＭ]\s*/i, "")) : NaN;
  return Number.isFinite(n) ? Math.round(n * 10) / 10 : null;
}

/**
 * A wall-clock time in a fixed UTC offset → Date.
 * `localWallTime(2026, 10, 6, 20, 11, 23, 7)` is 20:11:23 at UTC+7 = 13:11:23 UTC.
 */
export function localWallTime(y: number, mo: number, d: number, h: number, mi: number, s: number, offsetHours: number): Date {
  return new Date(Date.UTC(y, mo - 1, d, h, mi, s) - offsetHours * 3_600_000);
}

export function validLatLon(lat: number, lon: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0);
}

export function quakeCandidate(f: QuakeFacts): EventCandidateInput {
  const when = f.when.toISOString();
  const mag = f.magnitude;
  const depth = f.depthKm === null ? null : Math.round(Math.abs(f.depthKm) * 10) / 10;
  const title = `${mag !== null ? `M ${mag.toFixed(1)} earthquake` : "Earthquake"}${f.place ? ` — ${f.place}` : ""}`.slice(0, 300);
  return {
    type: "EARTHQUAKE",
    subtype: "earthquake",
    title,
    summary: (
      `${f.agency} reports ${mag !== null ? `a magnitude ${mag.toFixed(1)}${f.magnitudeType ? ` (${f.magnitudeType})` : ""}` : "an"} earthquake` +
      `${f.place ? ` (${f.place})` : ""}${depth !== null ? ` at a depth of ${Math.round(depth)} km` : ""}, at ${when.replace("T", " ").slice(0, 16)} UTC.` +
      (f.extraSummary ? ` ${f.extraSummary}` : "")
    ).slice(0, 2000),
    latitude: f.latitude,
    longitude: f.longitude,
    geoPrecision: "exact",
    locationName: f.place,
    country: f.country ?? null,
    timestamp: when,
    metrics: { magnitude: mag, magnitude_type: f.magnitudeType ?? null, depth_km: depth, ...f.extraMetrics },
    entities: [{ type: "ORGANIZATION", name: f.agency, code: null }],
    source: {
      id: `${f.dataSourceId}:${f.externalId}`,
      dataSourceId: f.dataSourceId,
      externalId: f.externalId,
      sourceName: f.sourceName,
      sourceUrl: f.sourceUrl,
      title: null,
      titleIsDerived: true,
      publishedAt: (f.publishedAt ?? f.when).toISOString(),
      retrievedAt: f.retrievedAt,
      sourceType: "OFFICIAL_AGENCY",
      assertion: f.assertion,
      credibility: { basis: f.credibilityBasis },
    },
    rawData: f.rawData,
  };
}
