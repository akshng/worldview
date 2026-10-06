/**
 * Environment and Climate Change Canada weather warnings, from the MSC GeoMet
 * OGC API (keyless). One event per warning area, with its polygon. Warnings only
 * (watches, advisories and statements are skipped); ended alerts are skipped.
 */
import type { AreaGeometry, EventCandidateInput } from "@/types/events";
import { plainText, httpGet, type DataSourceConnector, type FetchContext, type ParseContext, type ParseResult } from "../types";
import { polygonCentroid, simplifyArea } from "../weather/parser";
import type { NwsAlertFeature } from "../weather/types";

export interface EcccFeature {
  id: string;
  geometry: AreaGeometry | null;
  properties: {
    alert_code?: string;
    alert_type?: string;
    alert_name_en?: string;
    publication_datetime?: string;
    validity_datetime?: string;
    expiration_datetime?: string;
    event_end_datetime?: string | null;
    alert_text_en?: string | null;
    risk_colour_en?: string | null;
    feature_name_en?: string;
    province?: string;
    status_en?: string;
    feature_id?: string;
  };
}
export interface EcccRaw {
  features: EcccFeature[];
}

const PROVINCES: Record<string, string> = {
  AB: "Alberta", BC: "British Columbia", MB: "Manitoba", NB: "New Brunswick", NL: "Newfoundland and Labrador", NS: "Nova Scotia",
  NT: "Northwest Territories", NU: "Nunavut", ON: "Ontario", PE: "Prince Edward Island", QC: "Quebec", SK: "Saskatchewan", YT: "Yukon",
};

export async function fetchEccc(ctx: FetchContext): Promise<EcccRaw> {
  const res = await httpGet("https://api.weather.gc.ca/collections/weather-alerts/items?f=json&lang=en&alert_type=warning&limit=1000", ctx, { accept: "application/geo+json, application/json" });
  return (await res.json()) as EcccRaw;
}

export function categorizeEccc(name: string): { type: "WEATHER" | "FLOOD" | "INFRASTRUCTURE"; subtype: string } {
  const n = name.toLowerCase();
  if (n.includes("flood") || n.includes("storm surge")) return { type: "FLOOD", subtype: "flood" };
  if (n.includes("hurricane") || n.includes("tropical storm")) return { type: "WEATHER", subtype: "tropical-cyclone" };
  if (n.includes("tornado")) return { type: "WEATHER", subtype: "tornado" };
  if (n.includes("heat")) return { type: "WEATHER", subtype: "extreme-heat" };
  if (/snow|blizzard|freezing|winter|ice|frost|cold/.test(n)) return { type: "WEATHER", subtype: "winter" };
  return { type: "WEATHER", subtype: n.replace(/\s+warning$/, "").replace(/\s+/g, "-") || "weather" };
}

export function parseEccc(raw: EcccRaw, ctx: ParseContext): ParseResult {
  const candidates: EventCandidateInput[] = [];
  let skipped = 0;
  for (const f of raw.features ?? []) {
    const p = f.properties ?? {};
    const name = p.alert_name_en?.trim();
    // Issue time, not validity start (which can be in the future).
    const issued = p.publication_datetime ?? p.validity_datetime;
    const ends = p.event_end_datetime ?? p.expiration_datetime ?? null;
    if (!f.geometry || !name || !issued || p.alert_type !== "warning" || p.status_en === "ended" || (ends && Date.parse(ends) < ctx.now)) {
      skipped++;
      continue;
    }
    const c = polygonCentroid(f.geometry as NonNullable<NwsAlertFeature["geometry"]>);
    if (!c) {
      skipped++;
      continue;
    }
    const province = p.province ? (PROVINCES[p.province] ?? p.province) : null;
    const area = [p.feature_name_en, province].filter(Boolean).join(", ");
    const title = `${name.replace(/\b\w/, (x) => x.toUpperCase())} — ${area}`;
    const text = plainText(p.alert_text_en, 600);
    const { type, subtype } = categorizeEccc(name);
    candidates.push({
      type,
      subtype,
      title,
      summary: `Environment and Climate Change Canada issued a ${name} for ${area}${p.risk_colour_en ? ` (risk colour: ${p.risk_colour_en})` : ""}${ends ? `, in effect until ${new Date(ends).toISOString().slice(0, 16).replace("T", " ")} UTC` : ""}.`,
      description: text || null,
      latitude: c[1],
      longitude: c[0],
      geoPrecision: "region",
      geometry: simplifyArea(f.geometry as NonNullable<NwsAlertFeature["geometry"]>),
      locationName: area,
      country: "CA",
      timestamp: new Date(issued).toISOString(),
      resolvedAt: ends ? new Date(ends).toISOString() : null,
      metrics: { alert_code: p.alert_code ?? null, risk_colour: p.risk_colour_en ?? null, province: p.province ?? null },
      entities: [{ type: "ORGANIZATION", name: "Environment and Climate Change Canada", code: "ECCC" }],
      source: {
        id: `eccc:${f.id}`,
        dataSourceId: "eccc",
        externalId: f.id,
        sourceName: "Environment and Climate Change Canada — weather warnings",
        sourceUrl: "https://weather.gc.ca/warnings/index_e.html",
        title,
        titleIsDerived: true,
        publishedAt: new Date(p.publication_datetime ?? issued).toISOString(),
        retrievedAt: ctx.retrievedAt,
        sourceType: "OFFICIAL_AGENCY",
        assertion: "OFFICIAL_PRELIMINARY",
        credibility: { basis: "Government of Canada national weather service (MSC)" },
      },
      rawData: { id: f.id, ...p, alert_text_en: undefined },
    });
  }
  return { candidates, skipped };
}

export const ecccConnector: DataSourceConnector<EcccRaw> = {
  id: "eccc",
  name: "Canada weather warnings",
  description: "Active weather warnings (wind, rain, snow, heat, storm surge…) from Environment and Climate Change Canada, with warning-area polygons.",
  homepage: "https://weather.gc.ca/warnings/index_e.html",
  attribution: "Environment and Climate Change Canada — Open Government Licence – Canada",
  sourceType: "OFFICIAL_AGENCY",
  categories: ["WEATHER", "FLOOD"],
  refreshIntervalMs: 10 * 60_000,
  timeoutMs: 60_000,
  mode: "live",
  fetch: fetchEccc,
  parse: parseEccc,
};
