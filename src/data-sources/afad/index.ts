/**
 * Türkiye AFAD (Disaster and Emergency Management Authority) earthquake catalogue,
 * keyless event API. M3+ of the past 3 days. Dates have no zone suffix but are UTC
 * (checked against EMSC: AFAD 2026-10-04T22:51:29 = EMSC 22:51:30.9Z).
 */
import type { EventCandidateInput } from "@/types/events";
import { httpGet, type DataSourceConnector, type FetchContext, type ParseContext, type ParseResult } from "../types";
import { magnitudeOf, quakeCandidate, validLatLon } from "../quake-common";

export interface AfadEvent {
  eventID?: string;
  location?: string;
  latitude?: string;
  longitude?: string;
  depth?: string;
  type?: string; // magnitude type
  magnitude?: string;
  country?: string;
  province?: string;
  district?: string;
  date?: string;
  isEventUpdate?: boolean;
  lastUpdateDate?: string | null;
}

const fmt = (ms: number) => new Date(ms).toISOString().slice(0, 19);

export async function fetchAfad(ctx: FetchContext): Promise<AfadEvent[]> {
  const url = `https://deprem.afad.gov.tr/apiv2/event/filter?start=${fmt(ctx.now - 3 * 86_400_000)}&end=${fmt(ctx.now + 3_600_000)}&minmag=3&orderby=timedesc&limit=500`;
  const res = await httpGet(url, ctx);
  return (await res.json()) as AfadEvent[];
}

/** AFAD's zone-less timestamp, read as UTC. */
export function afadTime(s: string | undefined | null): Date | null {
  if (!s) return null;
  const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function parseAfad(raw: AfadEvent[], ctx: ParseContext): ParseResult {
  const candidates: EventCandidateInput[] = [];
  let skipped = 0;
  for (const e of raw ?? []) {
    const lat = Number(e.latitude), lon = Number(e.longitude);
    const when = afadTime(e.date);
    if (!e.eventID || !when || !validLatLon(lat, lon)) {
      skipped++;
      continue;
    }
    const country = e.country?.trim();
    const inTurkey = country === "Türkiye" || country === "Turkey";
    const place = [e.location?.trim(), country].filter(Boolean).join(", ") || null;
    const depth = Number.parseFloat(e.depth ?? "");
    candidates.push(
      quakeCandidate({
        dataSourceId: "afad",
        externalId: e.eventID,
        sourceName: "AFAD — Disaster and Emergency Management Authority (Türkiye)",
        agency: "AFAD",
        sourceUrl: `https://deprem.afad.gov.tr/event-detail/${encodeURIComponent(e.eventID)}`,
        credibilityBasis: "Turkish government disaster and emergency management authority (national seismic network)",
        assertion: "OFFICIAL_PRELIMINARY",
        when,
        publishedAt: afadTime(e.lastUpdateDate) ?? when,
        retrievedAt: ctx.retrievedAt,
        latitude: lat,
        longitude: lon,
        magnitude: magnitudeOf(e.magnitude),
        magnitudeType: e.type ?? null,
        depthKm: Number.isFinite(depth) ? depth : null,
        place,
        country: inTurkey ? "TR" : null,
        rawData: { eventID: e.eventID, location: e.location, province: e.province, district: e.district, isEventUpdate: e.isEventUpdate },
      }),
    );
  }
  return { candidates, skipped };
}

export const afadConnector: DataSourceConnector<AfadEvent[]> = {
  id: "afad",
  name: "AFAD earthquakes (Türkiye)",
  description: "M3+ earthquakes of the past 3 days in and around Türkiye from AFAD's national seismic network.",
  homepage: "https://deprem.afad.gov.tr/last-earthquakes",
  attribution: "AFAD (T.C. İçişleri Bakanlığı Afet ve Acil Durum Yönetimi Başkanlığı) — attribution required",
  sourceType: "OFFICIAL_AGENCY",
  categories: ["EARTHQUAKE"],
  refreshIntervalMs: 5 * 60_000,
  timeoutMs: 30_000,
  mode: "live",
  fetch: fetchAfad,
  parse: parseAfad,
};
