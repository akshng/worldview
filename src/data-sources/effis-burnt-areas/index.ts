/**
 * EFFIS (European Forest Fire Information System, Copernicus Emergency Management Service)
 * rapid damage assessment — burnt areas mapped from MODIS/VIIRS/Sentinel-2 imagery, keyless
 * REST API (`api.effis.emergency.copernicus.eu/rest/2/burntareas/current/`). Covers the EU,
 * neighbouring Europe, the Middle East and North Africa (`noneu` marks non-EU countries).
 *
 * One event per mapped burnt area of ≥ 50 ha whose fire started in the last 14 days, with its
 * perimeter (simplified) and the land-cover shares EFFIS computes. These are satellite
 * measurements of burnt land (not active-fire detections like FIRMS): the area may grow on
 * later updates, which re-ingest under the same EFFIS id.
 */
import type { AreaGeometry, EventCandidateInput } from "@/types/events";
import { httpGet, type DataSourceConnector, type FetchContext, type ParseContext, type ParseResult } from "../types";
import { simplifyArea } from "../weather/parser";
import type { NwsAlertFeature } from "../weather/types";
import { clip } from "../official-common";

export interface EffisBurntArea {
  id: number;
  centroid?: { type: "Point"; coordinates: [number, number] } | null;
  shape?: AreaGeometry | null;
  country?: string | null;
  countryful?: string | null;
  province?: string | null;
  commune?: string | null;
  firedate?: string | null;
  lastupdate?: string | null;
  area_ha?: number | null;
  broadlea?: string | null;
  conifer?: string | null;
  mixed?: string | null;
  scleroph?: string | null;
  transit?: string | null;
  othernatlc?: string | null;
  agriareas?: string | null;
  artifsurf?: string | null;
  otherlc?: string | null;
  percna2k?: string | null;
  noneu?: boolean;
}
export interface EffisRaw {
  results: EffisBurntArea[];
}

export const EFFIS_MIN_HA = 50;
const MAX_AGE_DAYS = 14;
const SITE = "https://forest-fire.emergency.copernicus.eu/apps/effis_current_situation/";

export async function fetchEffis(ctx: FetchContext): Promise<EffisRaw> {
  const since = new Date(ctx.now - MAX_AGE_DAYS * 86_400_000).toISOString().slice(0, 10);
  const url = `https://api.effis.emergency.copernicus.eu/rest/2/burntareas/current/?limit=200&ordering=-firedate&area_ha__gte=${EFFIS_MIN_HA}&firedate__gte=${since}`;
  const json = (await (await httpGet(url, ctx)).json()) as { results?: EffisBurntArea[] };
  // Perimeters can be tens of KB each; simplify them right away.
  return {
    results: (json.results ?? []).map((r) => ({ ...r, shape: r.shape && (r.shape.type === "Polygon" || r.shape.type === "MultiPolygon") ? simplifyArea(r.shape as NonNullable<NwsAlertFeature["geometry"]>) : null })),
  };
}

const NA = (s: string | null | undefined) => (s && !/^n\.?a\.?$/i.test(s.trim()) ? s.trim() : null);
const pct = (s: string | null | undefined) => {
  const n = s == null ? NaN : Number(s);
  return Number.isFinite(n) ? Math.round(n * 10) / 10 : null;
};

const COVER: Array<[keyof EffisBurntArea, string]> = [
  ["broadlea", "broadleaf forest"],
  ["conifer", "coniferous forest"],
  ["mixed", "mixed forest"],
  ["scleroph", "sclerophyllous vegetation"],
  ["transit", "transitional woodland/shrub"],
  ["othernatlc", "other natural land"],
  ["agriareas", "agricultural land"],
  ["artifsurf", "artificial surfaces"],
];

export function parseEffis(raw: EffisRaw, ctx: ParseContext): ParseResult {
  const candidates: EventCandidateInput[] = [];
  let skipped = 0;
  const seen = new Set<number>();
  for (const r of raw.results ?? []) {
    const [lon, lat] = r.centroid?.coordinates ?? [NaN, NaN];
    const t = r.firedate ? Date.parse(r.firedate) : NaN;
    const ha = typeof r.area_ha === "number" ? r.area_ha : NaN;
    if (!Number.isInteger(r.id) || seen.has(r.id) || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180 || Number.isNaN(t) || !(ha >= EFFIS_MIN_HA) || ctx.now - t > MAX_AGE_DAYS * 86_400_000 || t > ctx.now + 3_600_000) {
      skipped++;
      continue;
    }
    seen.add(r.id);
    const country = NA(r.countryful);
    const place = [NA(r.commune), NA(r.province), country].filter(Boolean).join(", ") || "Unnamed area";
    const covers = COVER.map(([k, label]) => [label, pct(r[k] as string | null)] as const).filter(([, v]) => v !== null && v >= 5).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0));
    const n2k = pct(r.percna2k);
    const when = new Date(t).toISOString();
    const haText = Math.round(ha).toLocaleString("en-US");
    candidates.push({
      type: "FIRE",
      subtype: "burnt area",
      title: clip(`Burnt area of ${haText} ha — ${place}`, 300),
      summary: clip(
        `EFFIS (Copernicus) mapped a burnt area of ${haText} ha (${(ha / 100).toFixed(1)} km²) at ${place} from satellite imagery; fire start date ${when.slice(0, 10)}.` +
          (covers.length ? ` Land cover burnt: ${covers.map(([l, v]) => `${v}% ${l}`).join(", ")}.` : "") +
          (n2k ? ` ${n2k}% inside Natura 2000 protected sites.` : "") +
          " The mapped area can grow on later EFFIS updates.",
        1990,
      ),
      description: null,
      latitude: lat,
      longitude: lon,
      geoPrecision: "exact",
      geometry: r.shape ?? null,
      locationName: place,
      country: r.country && /^[A-Z]{2}$/.test(r.country) ? (r.country === "UK" ? "GB" : r.country === "EL" ? "GR" : r.country) : null,
      timestamp: when,
      metrics: { area_ha: Math.round(ha), natura2000_pct: n2k, forest_pct: [pct(r.broadlea), pct(r.conifer), pct(r.mixed)].reduce<number | null>((s, v) => (v === null ? s : (s ?? 0) + v), null), non_eu: r.noneu ?? null },
      entities: [{ type: "ORGANIZATION", name: "European Forest Fire Information System", code: "EFFIS" }],
      source: {
        id: `effis-burnt-areas:${r.id}`,
        dataSourceId: "effis-burnt-areas",
        externalId: String(r.id),
        sourceName: "EFFIS — European Forest Fire Information System (Copernicus EMS)",
        sourceUrl: SITE,
        title: null,
        titleIsDerived: false,
        publishedAt: r.lastupdate && !Number.isNaN(Date.parse(r.lastupdate)) ? new Date(r.lastupdate).toISOString() : null,
        retrievedAt: ctx.retrievedAt,
        sourceType: "SATELLITE",
        assertion: "MEASUREMENT",
        credibility: { basis: "European Commission Joint Research Centre / Copernicus Emergency Management Service (satellite burnt-area mapping)" },
      },
      rawData: { id: r.id, firedate: r.firedate, lastupdate: r.lastupdate, area_ha: r.area_ha, country: r.country, province: r.province, commune: r.commune },
    });
  }
  return { candidates, skipped };
}

export const effisBurntAreasConnector: DataSourceConnector<EffisRaw> = {
  id: "effis-burnt-areas",
  name: "EFFIS burnt areas (Europe, MENA)",
  description: "Wildfire burnt areas of 50 ha or more mapped by Copernicus EFFIS from satellite imagery in Europe, the Middle East and North Africa (fires of the last 14 days), with perimeters.",
  homepage: SITE,
  attribution: "European Forest Fire Information System (EFFIS), European Commission JRC — Copernicus EMS; reuse with attribution",
  sourceType: "SATELLITE",
  categories: ["FIRE"],
  refreshIntervalMs: 3 * 60 * 60_000,
  timeoutMs: 60_000,
  mode: "live",
  fetch: fetchEffis,
  parse: parseEffis,
};
