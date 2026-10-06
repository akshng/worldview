/**
 * Australian emergency incidents and warnings (keyless public GeoJSON):
 *  - NSW Rural Fire Service "major incidents" feed — bush and grass fires
 *  - VicEmergency (Victoria) — official warnings (floods, fires, storms) and significant bushfires
 */
import type { EventCandidateInput, EventCategory } from "@/types/events";
import { interiorPoint } from "@/lib/geo/math";
import { httpGet, plainText, safeUrl, type DataSourceConnector, type FetchContext, type ParseContext, type ParseResult } from "../types";

type Geometry = { type: string; coordinates?: unknown; geometries?: Geometry[] };
export interface AuFeature {
  geometry: Geometry | null;
  properties: Record<string, unknown>;
}
export interface AuRaw {
  nsw: AuFeature[];
  vic: AuFeature[];
}

export async function fetchAuEmergency(ctx: FetchContext): Promise<AuRaw> {
  const [nsw, vic] = await Promise.allSettled([
    httpGet("https://www.rfs.nsw.gov.au/feeds/majorIncidents.json", ctx).then((r) => r.json()),
    httpGet("https://emergency.vic.gov.au/public/events-geojson.json", ctx).then((r) => r.json()),
  ]);
  if (nsw.status === "rejected" && vic.status === "rejected") throw nsw.reason;
  return {
    nsw: nsw.status === "fulfilled" ? ((nsw.value as { features?: AuFeature[] }).features ?? []) : [],
    vic: vic.status === "fulfilled" ? ((vic.value as { features?: AuFeature[] }).features ?? []) : [],
  };
}

/** A representative point: the first Point in the geometry, else inside the first polygon. */
export function pointOf(g: Geometry | null | undefined): [number, number] | null {
  if (!g) return null;
  if (g.type === "Point" && Array.isArray(g.coordinates)) return g.coordinates as [number, number];
  if (g.type === "GeometryCollection") {
    for (const sub of g.geometries ?? []) if (sub.type === "Point") return pointOf(sub);
    for (const sub of g.geometries ?? []) {
      const p = pointOf(sub);
      if (p) return p;
    }
  }
  if (g.type === "Polygon") return interiorPoint(g.coordinates as Array<Array<[number, number]>>);
  if (g.type === "MultiPolygon") return interiorPoint((g.coordinates as Array<Array<Array<[number, number]>>>)[0]);
  return null;
}

/** "ALERT LEVEL: Advice <br />LOCATION: … <br />SIZE: 26 ha" → { "ALERT LEVEL": "Advice", … } */
export function rfsFields(description: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of description.split(/<br\s*\/?>/i)) {
    const m = part.match(/^\s*([A-Z ]+):\s*(.*)$/);
    if (m) out[m[1].trim()] = plainText(m[2], 200);
  }
  return out;
}

/** RFS pubDate "6/10/2026 5:21:00 AM" (day/month, UTC). */
export function rfsDate(s: string): Date | null {
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}) (\d{1,2}):(\d{2}):(\d{2}) (AM|PM)$/);
  if (!m) return null;
  let h = Number(m[4]) % 12;
  if (m[7] === "PM") h += 12;
  return new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1]), h, Number(m[5]), Number(m[6])));
}

const titleCase = (s: string) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
const LEVELS = ["advice", "watch and act", "watch & act", "emergency warning"];

function base(id: string, name: string, url: string | null, at: Date, ctx: ParseContext, basis: string) {
  return {
    id: `au-emergency:${id}`,
    dataSourceId: "au-emergency",
    externalId: id,
    sourceName: name,
    sourceUrl: url,
    title: null,
    titleIsDerived: true,
    publishedAt: at.toISOString(),
    retrievedAt: ctx.retrievedAt,
    sourceType: "OFFICIAL_AGENCY" as const,
    assertion: "OFFICIAL_PRELIMINARY" as const,
    credibility: { basis },
  };
}

export function parseAuEmergency(raw: AuRaw, ctx: ParseContext): ParseResult {
  const candidates: EventCandidateInput[] = [];
  let skipped = 0;

  for (const f of raw.nsw ?? []) {
    const p = f.properties as { title?: string; category?: string; guid?: string; link?: string; pubDate?: string; description?: string };
    const fields = rfsFields(p.description ?? "");
    const at = p.pubDate ? rfsDate(p.pubDate) : null;
    const pt = pointOf(f.geometry);
    const level = (fields["ALERT LEVEL"] ?? p.category ?? "").trim();
    const ha = Number((fields["SIZE"] ?? "").replace(/[^\d.]/g, ""));
    const significant = LEVELS.includes(level.toLowerCase()) || ha >= 50;
    if (!at || !pt || !p.title || p.category === "Planned Burn" || /planned burn|hazard reduction/i.test(fields["TYPE"] ?? "") || !significant) {
      skipped++;
      continue;
    }
    const kind = fields["TYPE"] || "Fire";
    const where = titleCase(p.title);
    candidates.push({
      type: "FIRE",
      subtype: /grass/i.test(kind) ? "grass fire" : "bushfire",
      title: `${kind} — ${where}, NSW${level && level !== "Not Applicable" ? ` (${level})` : ""}`,
      summary:
        `NSW Rural Fire Service reports a ${kind.toLowerCase()} at ${where}${fields["COUNCIL AREA"] ? ` (${fields["COUNCIL AREA"]})` : ""}` +
        `${level && level !== "Not Applicable" ? `, alert level ${level}` : ""}${fields["STATUS"] ? `, status: ${fields["STATUS"].toLowerCase()}` : ""}` +
        `${Number.isFinite(ha) && ha > 0 ? `, about ${ha.toLocaleString("en-US")} ha` : ""}.`,
      latitude: pt[1],
      longitude: pt[0],
      geoPrecision: "city",
      locationName: `${where}, New South Wales`,
      country: "AU",
      timestamp: at.toISOString(),
      metrics: { alert_level: level || null, hectares: Number.isFinite(ha) ? ha : null, status: fields["STATUS"] ?? null },
      entities: [{ type: "ORGANIZATION", name: "NSW Rural Fire Service", code: "RFS" }],
      source: base(`nsw:${(p.guid ?? p.title).split("/").pop()}`, "NSW Rural Fire Service — major incidents", safeUrl(p.guid?.startsWith("http") ? "https://www.rfs.nsw.gov.au/fire-information/fires-near-me" : p.link), at, ctx, "New South Wales state fire agency"),
      rawData: { title: p.title, category: p.category, ...fields },
    });
  }

  for (const f of raw.vic ?? []) {
    const p = f.properties as Record<string, string | null | undefined> & { cap?: { event?: string; severity?: string } };
    const pt = pointOf(f.geometry);
    const at = p.updated ?? p.created ? new Date(String(p.updated ?? p.created)) : null;
    const isWarning = p.feedType === "warning" && LEVELS.includes(String(p.name ?? p.category1 ?? "").toLowerCase());
    const ha = Number(String(p.sizeFmt ?? "").replace(/[^\d.]/g, ""));
    const isBigFire = p.feedType === "incident" && p.category1 === "Fire" && p.category2 === "Bushfire" && ha >= 10 && p.status !== "Safe";
    if (!pt || !at || Number.isNaN(at.getTime()) || !p.location || (!isWarning && !isBigFire)) {
      skipped++;
      continue;
    }
    const capEvent = p.cap?.event ?? null;
    let type: EventCategory = "FIRE";
    let subtype = "bushfire";
    if (isWarning) {
      const e = (capEvent ?? p.category2 ?? "").toLowerCase();
      [type, subtype] = /flood/.test(e) ? ["FLOOD", "flood"] : /fire/.test(e) ? ["FIRE", "bushfire"] : ["WEATHER", e.replace(/\s+/g, "-") || "warning"];
    }
    const where = String(p.location);
    const label = isWarning ? `${p.name} — ${capEvent ?? "warning"}` : `Bushfire${Number.isFinite(ha) ? ` — ${ha.toLocaleString("en-US")} ha` : ""}`;
    candidates.push({
      type,
      subtype,
      title: `${label}: ${where}, VIC`,
      summary: isWarning
        ? `VicEmergency issued a "${p.name}" ${capEvent ? `${capEvent.toLowerCase()} ` : ""}warning for ${where}, Victoria${p.cap?.severity ? ` (severity: ${p.cap.severity.toLowerCase()})` : ""}.`
        : `VicEmergency lists a bushfire ${where}, Victoria${Number.isFinite(ha) ? `, about ${ha.toLocaleString("en-US")} ha` : ""}, status: ${String(p.status ?? "unknown").toLowerCase()}.`,
      latitude: pt[1],
      longitude: pt[0],
      geoPrecision: isWarning ? "region" : "city",
      locationName: `${where}, Victoria`,
      country: "AU",
      timestamp: at.toISOString(),
      metrics: { warning_level: isWarning ? (p.name ?? null) : null, hectares: Number.isFinite(ha) ? ha : null, status: p.status ?? null },
      entities: [{ type: "ORGANIZATION", name: "Emergency Management Victoria", code: "EMV" }],
      source: base(`vic:${p.sourceOrg ?? "EMV"}:${p.id}`, "VicEmergency (Emergency Management Victoria)", "https://emergency.vic.gov.au/respond/", at, ctx, "Victorian state emergency management agency"),
      rawData: { id: p.id, feedType: p.feedType, category1: p.category1, category2: p.category2, name: p.name, location: p.location, status: p.status, cap: p.cap },
    });
  }
  return { candidates, skipped };
}

export const auEmergencyConnector: DataSourceConnector<AuRaw> = {
  id: "au-emergency",
  name: "Australia fires & warnings",
  description: "NSW Rural Fire Service major fire incidents and VicEmergency warnings (floods, fires, storms) and significant bushfires in Victoria.",
  homepage: "https://emergency.vic.gov.au/",
  attribution: "NSW Rural Fire Service; Emergency Management Victoria — public feeds",
  sourceType: "OFFICIAL_AGENCY",
  categories: ["FIRE", "FLOOD", "WEATHER"],
  refreshIntervalMs: 10 * 60_000,
  mode: "live",
  fetch: fetchAuEmergency,
  parse: parseAuEmergency,
};
