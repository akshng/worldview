import type { EventCandidateInput, EventCategory } from "@/types/events";
import { plainText, safeUrl, type ParseContext, type ParseResult } from "../types";
import type { AreaGeometry } from "@/types/events";
import { interiorPoint, mainPolygon, simplifyRing } from "@/lib/geo/math";
import type { NwsAlertCollection, NwsAlertFeature } from "./types";
import { nwsSeriesKey } from "@/lib/events/series";

type Pt = [number, number];

/** Representative point guaranteed inside the (largest) warning polygon. */
export function polygonCentroid(g: NonNullable<NwsAlertFeature["geometry"]>): [number, number] | null {
  const poly = mainPolygon(g as AreaGeometry) as Pt[][];
  if (!poly?.[0]?.length) return null;
  return interiorPoint(poly);
}

export function simplifyArea(g: NonNullable<NwsAlertFeature["geometry"]>): AreaGeometry {
  const simp = (poly: number[][][]) => poly.map((r) => simplifyRing(r as Pt[], 0.002));
  return g.type === "Polygon"
    ? { type: "Polygon", coordinates: simp(g.coordinates) }
    : { type: "MultiPolygon", coordinates: g.coordinates.map(simp) };
}

function categorize(event: string): { type: EventCategory; subtype: string } {
  const e = event.toLowerCase();
  if (e.includes("flood")) return { type: "FLOOD", subtype: e.includes("flash") ? "flash-flood" : "flood" };
  if (e.includes("tsunami")) return { type: "WEATHER", subtype: "tsunami" };
  if (e.includes("red flag") || e.includes("fire weather")) return { type: "WEATHER", subtype: "fire-weather" };
  if (e.includes("hurricane") || e.includes("tropical storm") || e.includes("typhoon")) return { type: "WEATHER", subtype: "tropical-cyclone" };
  if (e.includes("tornado")) return { type: "WEATHER", subtype: "tornado" };
  if (e.includes("heat")) return { type: "WEATHER", subtype: "extreme-heat" };
  if (e.includes("winter") || e.includes("blizzard") || e.includes("snow") || e.includes("ice") || e.includes("freeze")) return { type: "WEATHER", subtype: "winter" };
  if (e.includes("emergency")) return { type: "INFRASTRUCTURE", subtype: "civil-emergency" };
  return { type: "WEATHER", subtype: e.replace(/\s+(warning|watch|advisory|statement)$/, "").replace(/\s+/g, "-") };
}

export interface Vtec {
  action: string;
  office: string;
  phenomena: string;
  significance: string;
  etn: string;
  /** Year the event tracking number belongs to (ETNs restart every year). */
  year: number;
}

/** Parse a P-VTEC string ("/O.EXT.KPSR.FL.W.0012.000000T0000Z-261106T0300Z/"). */
export function parseVtec(s: string, sentIso: string): Vtec | null {
  const m = s.match(/\/[OTEX]\.([A-Z]{3})\.([A-Z]{4})\.([A-Z]{2})\.([A-Z])\.(\d{4})\.(\d{6})T\d{4}Z-(\d{6})T\d{4}Z\//);
  if (!m) return null;
  const begin = m[6] !== "000000" ? m[6] : m[7] !== "000000" ? m[7] : null;
  const year = begin ? 2000 + Number(begin.slice(0, 2)) : new Date(sentIso).getUTCFullYear();
  return { action: m[1], office: m[2], phenomena: m[3], significance: m[4], etn: m[5], year };
}

/**
 * Stable record id for one warning across its updates: the VTEC event tracking number
 * (office.phenomena.significance.ETN.year). Updates, extensions and cancellations of the
 * same warning then update one event in place. Alerts without VTEC keep the message id.
 */
export function nwsRecordId(p: Pick<NwsAlertFeature["properties"], "id" | "parameters" | "sent">): string {
  const vtecs = (p.parameters?.VTEC ?? []).map((v) => parseVtec(v, p.sent)).filter((v): v is Vtec => !!v);
  const v = vtecs.find((x) => !["CAN", "EXP", "UPG"].includes(x.action)) ?? vtecs[0];
  return v ? `vtec:${v.office}.${v.phenomena}.${v.significance}.${v.etn}.${v.year}` : p.id;
}


export function parseNwsAlerts(fc: NwsAlertCollection, ctx: ParseContext): ParseResult {
  const candidates: EventCandidateInput[] = [];
  let skipped = 0;
  for (const f of fc.features ?? []) {
    const p = f.properties;
    // Zone-only alerts have no polygon; resolving zones would cost one request each.
    const c = f.geometry ? polygonCentroid(f.geometry) : null;
    if (!c || p.status !== "Actual") {
      skipped++;
      continue;
    }
    const { type, subtype } = categorize(p.event);
    const area = p.areaDesc.length > 120 ? `${p.areaDesc.slice(0, 117)}…` : p.areaDesc;
    // Cancellations end the alert now; otherwise use the stated end/expiry.
    const end = p.messageType === "Cancel" ? p.sent : (p.ends ?? p.expires);
    candidates.push({
      type,
      subtype,
      title: `${p.event} — ${area}`,
      summary:
        `${p.senderName} issued a ${p.event} (${p.severity.toLowerCase()} severity, ${p.urgency.toLowerCase()} urgency, ` +
        `certainty: ${p.certainty.toLowerCase()}) for ${area}` +
        `${end ? `, in effect until ${new Date(end).toISOString().replace("T", " ").slice(0, 16)} UTC` : ""}.`,
      description: plainText(p.description, 1500) || null,
      latitude: c[1],
      longitude: c[0],
      geoPrecision: "region",
      geometry: simplifyArea(f.geometry!),
      locationName: area,
      country: "US",
      timestamp: new Date(p.effective ?? p.sent).toISOString(),
      resolvedAt: end ? new Date(end).toISOString() : null,
      metrics: { event_name: p.event, severity: p.severity, urgency: p.urgency, certainty: p.certainty },
      // Updates/cancellations replace the earlier alert messages they reference.
      supersedes: (p.references ?? []).map((r) => `nws:${r.identifier}`),
      seriesKey: nwsSeriesKey(p.event, c[1], c[0]),
      entities: [{ type: "ORGANIZATION", name: p.senderName, code: null }],
      source: {
        id: `nws:${nwsRecordId(p)}`,
        dataSourceId: "nws",
        externalId: nwsRecordId(p),
        sourceName: "U.S. National Weather Service",
        sourceUrl: safeUrl(p["@id"]),
        title: p.headline,
        titleIsDerived: false,
        publishedAt: new Date(p.sent).toISOString(),
        retrievedAt: ctx.retrievedAt,
        sourceType: "OFFICIAL_AGENCY",
        assertion: "OFFICIAL_PRELIMINARY",
        credibility: { basis: "Official NWS alert product (forecast/warning)" },
      },
      rawData: { id: p.id, event: p.event, sent: p.sent, areaDesc: p.areaDesc, messageType: p.messageType, vtec: p.parameters?.VTEC ?? [] },
    });
  }
  return { candidates, skipped, warnings: skipped ? [`${skipped} alerts skipped (zone-only, no polygon)`] : [] };
}
