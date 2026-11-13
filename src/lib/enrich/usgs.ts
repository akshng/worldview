/**
 * USGS earthquake enrichment — pure parsers (no I/O, safe on client and server).
 *
 * The USGS event-detail GeoJSON
 * (https://earthquake.usgs.gov/fdsnws/event/1/query?eventid=<id>&format=geojson)
 * lists the products computed for an event: ShakeMap (ground-shaking intensity),
 * PAGER (alert level, estimated fatalities/losses, population exposure) and DYFI
 * ("Did You Feel It?" citizen reports). Everything here is a fact from USGS and
 * links back to the USGS event page.
 */

export const USGS_HOST = "https://earthquake.usgs.gov/";

export type PagerLevel = "green" | "yellow" | "orange" | "red";
const PAGER_LEVELS: readonly PagerLevel[] = ["green", "yellow", "orange", "red"];

/** A USGS ComCat event id: network code + event code, e.g. "us7000twg9", "ak0251abcd", "nc75012345". */
export function isUsgsEventId(id: unknown): id is string {
  return typeof id === "string" && /^[a-z]{2}[a-z0-9]{4,18}$/i.test(id);
}

/** The USGS event id of a WorldEvent's USGS source, or null when it didn't come from USGS. */
export function usgsEventIdFrom(sources: readonly { dataSourceId: string; externalId?: string | null }[]): string | null {
  for (const s of sources) if (s.dataSourceId === "usgs" && isUsgsEventId(s.externalId)) return s.externalId;
  return null;
}

/** Product file URLs are only followed when they point at USGS itself. */
export function safeUsgsUrl(u: unknown): string | null {
  return typeof u === "string" && u.startsWith(USGS_HOST) && !u.includes("..") ? u : null;
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

const pagerLevel = (v: unknown): PagerLevel | null =>
  typeof v === "string" && (PAGER_LEVELS as readonly string[]).includes(v.toLowerCase()) ? (v.toLowerCase() as PagerLevel) : null;

// ---- Modified Mercalli Intensity --------------------------------------------------

const ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];
/** USGS ShakeMap shaking descriptions by MMI (I…X+). */
const MMI_SHAKING = ["", "Not felt", "Weak", "Weak", "Light", "Moderate", "Strong", "Very strong", "Severe", "Violent", "Extreme"];
/** USGS ShakeMap intensity colour scale. */
const MMI_COLORS = ["#ffffff", "#ffffff", "#bfccff", "#a0e6ff", "#80ffff", "#7aff93", "#ffff00", "#ffc800", "#ff9100", "#ff0000", "#c80000"];

/** Roman numeral for an intensity (rounded; clamps to I…XII). */
export function mmiRoman(mmi: number): string {
  const r = Math.max(1, Math.min(12, Math.round(mmi)));
  return ROMAN[r];
}

/** "Strong" etc. for an intensity, following the USGS ShakeMap legend. */
export function mmiShaking(mmi: number): string {
  const r = Math.max(1, Math.min(10, Math.round(mmi)));
  return MMI_SHAKING[r];
}

export function mmiColor(mmi: number): string {
  const r = Math.max(0, Math.min(10, Math.round(mmi)));
  return MMI_COLORS[r];
}

// ---- event detail -----------------------------------------------------------------

interface UsgsProduct {
  status?: string;
  updateTime?: number;
  properties?: Record<string, string | undefined>;
  contents?: Record<string, { url?: string } | undefined>;
}

interface UsgsDetail {
  id?: string;
  properties?: {
    mag?: number | null;
    title?: string | null;
    url?: string | null;
    felt?: number | null;
    cdi?: number | null;
    mmi?: number | null;
    alert?: string | null;
    tsunami?: number | null;
    sig?: number | null;
    status?: string | null;
    products?: Record<string, UsgsProduct[] | undefined>;
  };
}

export interface ShakeMapSummary {
  /** Highest intensity in the ShakeMap grid. */
  maxMmi: number | null;
  /** "automatic" or "reviewed". */
  status: string | null;
  contoursUrl: string | null;
  pageUrl: string;
}

export interface PagerSummary {
  level: PagerLevel | null;
  alertsUrl: string | null;
  exposuresUrl: string | null;
  pageUrl: string;
}

export interface DyfiSummary {
  responses: number | null;
  maxCdi: number | null;
  pageUrl: string;
}

export interface UsgsDetailSummary {
  id: string;
  title: string | null;
  magnitude: number | null;
  eventUrl: string;
  /** USGS "tsunami" flag: the event is in a region where tsunami information is issued — not itself a warning. */
  tsunamiFlag: boolean;
  feltReports: number | null;
  maxCdi: number | null;
  maxMmi: number | null;
  alert: PagerLevel | null;
  shakemap: ShakeMapSummary | null;
  pager: PagerSummary | null;
  dyfi: DyfiSummary | null;
}

/** Preferred (first, most recent) non-deleted product of a type. */
function product(detail: UsgsDetail, type: string): UsgsProduct | null {
  const list = detail.properties?.products?.[type];
  return list?.find((p) => p && p.status !== "DELETE") ?? null;
}

function contentUrl(p: UsgsProduct, ...names: string[]): string | null {
  for (const n of names) {
    const u = safeUsgsUrl(p.contents?.[n]?.url);
    if (u) return u;
  }
  return null;
}

/** Extract the parts of the event-detail GeoJSON the panel shows. */
export function parseUsgsDetail(raw: unknown, fallbackId: string): UsgsDetailSummary | null {
  const d = raw as UsgsDetail;
  if (!d || typeof d !== "object" || !d.properties) return null;
  const p = d.properties;
  const id = isUsgsEventId(d.id) ? d.id : fallbackId;
  const eventUrl = safeUsgsUrl(p.url) ?? `${USGS_HOST}earthquakes/eventpage/${id}`;

  const sm = product(d, "shakemap");
  let shakemap: ShakeMapSummary | null = null;
  if (sm) {
    const props = sm.properties ?? {};
    // "maxmmi" is "nan" when only the interpolated grid has a value.
    const maxMmi = num(props.maxmmi) ?? num(props["maxmmi-grid"]);
    shakemap = {
      maxMmi: maxMmi === null ? null : Math.round(maxMmi * 10) / 10,
      status: props["review-status"] ?? props["map-status"] ?? null,
      contoursUrl: contentUrl(sm, "download/cont_mmi.json", "download/cont_mi.json"),
      pageUrl: `${eventUrl}/shakemap`,
    };
  }

  const pg = product(d, "losspager");
  const pager: PagerSummary | null = pg
    ? {
        level: pagerLevel(pg.properties?.alertlevel) ?? pagerLevel(p.alert),
        alertsUrl: contentUrl(pg, "json/alerts.json", "alerts.json"),
        exposuresUrl: contentUrl(pg, "json/exposures.json", "exposures.json"),
        pageUrl: `${eventUrl}/pager`,
      }
    : null;

  const dy = product(d, "dyfi");
  const dyfi: DyfiSummary | null = dy
    ? {
        responses: num(dy.properties?.["num-responses"]) ?? num(dy.properties?.numResp) ?? num(p.felt),
        maxCdi: num(dy.properties?.maxmmi) ?? num(p.cdi),
        pageUrl: `${eventUrl}/dyfi`,
      }
    : null;

  return {
    id,
    title: p.title ?? null,
    magnitude: num(p.mag),
    eventUrl,
    tsunamiFlag: p.tsunami === 1,
    feltReports: num(p.felt),
    maxCdi: num(p.cdi),
    maxMmi: num(p.mmi),
    alert: pagerLevel(p.alert),
    shakemap,
    pager,
    dyfi,
  };
}

// ---- PAGER --------------------------------------------------------------------------

export interface PagerRange {
  /** Lower bound (fatalities, or US$ millions for losses). */
  min: number;
  /** Upper bound; null = open-ended. */
  max: number | null;
  probability: number;
}

export interface PagerEstimate {
  level: PagerLevel | null;
  /** Most likely range by PAGER's probability. */
  likely: PagerRange | null;
}

interface PagerAlertsRaw {
  fatality?: { level?: string; bins?: { min?: string | number; max?: string | number; probability?: number }[] };
  economic?: { level?: string; bins?: { min?: string | number; max?: string | number; probability?: number }[] };
}

function estimate(part: PagerAlertsRaw["fatality"]): PagerEstimate | null {
  if (!part) return null;
  let likely: PagerRange | null = null;
  for (const b of part.bins ?? []) {
    const min = num(b.min);
    const p = num(b.probability);
    if (min === null || p === null) continue;
    if (!likely || p > likely.probability) {
      const max = num(b.max);
      // PAGER's last bin has a huge sentinel upper bound; treat it as open-ended.
      likely = { min, max: max !== null && max < 1e6 ? max : null, probability: Math.round(p * 1000) / 1000 };
    }
  }
  return { level: pagerLevel(part.level), likely };
}

/** PAGER alerts.json → fatality and economic-loss (US$ millions) estimates. */
export function parsePagerAlerts(raw: unknown): { fatalities: PagerEstimate | null; losses: PagerEstimate | null } {
  const r = (raw ?? {}) as PagerAlertsRaw;
  return { fatalities: estimate(r.fatality), losses: estimate(r.economic) };
}

export interface ExposureRow {
  mmi: number;
  population: number;
}

/** PAGER exposures.json → estimated population exposed per intensity (non-zero rows, strongest first). */
export function parsePagerExposures(raw: unknown): ExposureRow[] {
  const pe = (raw as { population_exposure?: { mmi?: number[]; aggregated_exposure?: number[] } } | null)?.population_exposure;
  if (!pe?.mmi || !pe.aggregated_exposure) return [];
  const rows: ExposureRow[] = [];
  pe.mmi.forEach((m, i) => {
    const pop = num(pe.aggregated_exposure![i]);
    if (Number.isFinite(m) && pop !== null && pop > 0) rows.push({ mmi: m, population: Math.round(pop) });
  });
  return rows.sort((a, b) => b.mmi - a.mmi);
}

/** "1–10", "1,000+", "0–1" for a PAGER range (fatalities). */
export function formatPagerRange(r: PagerRange, unit: "people" | "usd_millions"): string {
  const f = (n: number) => {
    if (unit === "usd_millions") {
      if (n === 0) return "$0";
      if (n >= 1000) return `$${(n / 1000).toLocaleString("en-US")}B`;
      return `$${n.toLocaleString("en-US")}M`;
    }
    return n.toLocaleString("en-US");
  };
  return r.max === null ? `${f(r.min)}+` : `${f(r.min)}–${f(r.max)}`;
}

// ---- ShakeMap contours ---------------------------------------------------------------

export interface MmiContourProps {
  mmi: number;
  color: string;
  /** Roman numeral label for whole intensities, "" for half steps. */
  label: string;
}

export type MmiContours = GeoJSON.FeatureCollection<GeoJSON.MultiLineString, MmiContourProps>;

const MAX_CONTOUR_POINTS = 40_000;

/**
 * ShakeMap cont_mmi.json (MultiLineString per intensity) → a lean FeatureCollection
 * with rounded coordinates (~10 m) and a colour/label per line.
 */
export function parseMmiContours(raw: unknown): MmiContours {
  const out: MmiContours = { type: "FeatureCollection", features: [] };
  const feats = (raw as { features?: unknown[] } | null)?.features;
  if (!Array.isArray(feats)) return out;
  let points = 0;
  for (const f of feats as { properties?: { value?: unknown; color?: unknown }; geometry?: { type?: string; coordinates?: unknown } }[]) {
    const mmi = num(f?.properties?.value);
    const g = f?.geometry;
    if (mmi === null || !g || !Array.isArray(g.coordinates)) continue;
    const lines = (g.type === "LineString" ? [g.coordinates] : g.type === "MultiLineString" ? g.coordinates : []) as unknown[];
    const clean: [number, number][][] = [];
    for (const line of lines) {
      if (!Array.isArray(line)) continue;
      const pts: [number, number][] = [];
      for (const c of line) {
        if (!Array.isArray(c)) continue;
        const lon = num(c[0]);
        const lat = num(c[1]);
        if (lon === null || lat === null || Math.abs(lat) > 90 || Math.abs(lon) > 540) continue;
        pts.push([Math.round(lon * 1e4) / 1e4, Math.round(lat * 1e4) / 1e4]);
      }
      if (pts.length >= 2) clean.push(pts);
      points += pts.length;
    }
    if (!clean.length) continue;
    if (points > MAX_CONTOUR_POINTS) break;
    const color = typeof f.properties?.color === "string" && /^#[0-9a-f]{6}$/i.test(f.properties.color) ? f.properties.color : mmiColor(mmi);
    out.features.push({
      type: "Feature",
      properties: { mmi, color, label: Number.isInteger(mmi) ? mmiRoman(mmi) : "" },
      geometry: { type: "MultiLineString", coordinates: clean },
    });
  }
  return out;
}

// ---- assembled context ------------------------------------------------------------

export interface EarthquakeContext {
  id: string;
  title: string | null;
  magnitude: number | null;
  eventUrl: string;
  tsunamiFlag: boolean;
  feltReports: number | null;
  shakemap: { maxMmi: number | null; status: string | null; hasContours: boolean; pageUrl: string } | null;
  pager: {
    level: PagerLevel | null;
    fatalities: PagerEstimate | null;
    losses: PagerEstimate | null;
    exposure: ExposureRow[];
    pageUrl: string;
  } | null;
  dyfi: { responses: number | null; maxCdi: number | null; pageUrl: string } | null;
  retrievedAt: string;
}

/** True when there's anything worth showing beyond what the event record already has. */
export function hasImpactData(c: EarthquakeContext | null | undefined): c is EarthquakeContext {
  return !!c && !!(c.shakemap || c.pager || c.dyfi);
}
