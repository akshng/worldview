/**
 * Pure parsers/builders for the strategic-infrastructure layers. Used by
 * scripts/build-infra.ts (and tests); no network or filesystem access here.
 */
import { haversineKm } from "@/lib/geo/math";

export type Pt = [number, number];

export interface PointFeature<P> {
  type: "Feature";
  geometry: { type: "Point"; coordinates: Pt };
  properties: P;
}
export interface LineFeature<P> {
  type: "Feature";
  geometry: { type: "LineString"; coordinates: Pt[] } | { type: "MultiLineString"; coordinates: Pt[][] };
  properties: P;
}

const round = (n: number, d: number) => {
  const f = 10 ** d;
  return Math.round(n * f) / f + 0;
};
const pt = (lon: number, lat: number, d = 3): Pt => [round(lon, d), round(lat, d)];
const point = <P>(lon: number, lat: number, properties: P, d = 3): PointFeature<P> => ({
  type: "Feature",
  geometry: { type: "Point", coordinates: pt(lon, lat, d) },
  properties,
});
const valid = (lon: number, lat: number) => Number.isFinite(lon) && Number.isFinite(lat) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lon === 0 && lat === 0);
/** Number from a CSV cell; blank → NaN (not 0). */
const num = (s: string | undefined) => (s === undefined || s.trim() === "" ? NaN : Number(s));
const clean = (s: string | undefined | null) => {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t ? t.slice(0, 120) : null;
};

// ---- CSV ---------------------------------------------------------------------

/** RFC 4180 CSV → rows (handles quoted fields, escaped quotes, CRLF and a BOM). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export function csvRecords(text: string): Record<string, string>[] {
  const [head, ...rows] = parseCsv(text);
  if (!head) return [];
  const keys = head.map((h) => h.trim());
  return rows.map((r) => Object.fromEntries(keys.map((k, i) => [k, r[i] ?? ""])));
}

// ---- geometry ----------------------------------------------------------------

/** Perpendicular distance (degrees, planar) from p to segment ab. */
function segDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len = dx * dx + dy * dy;
  let t = len ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** Douglas–Peucker for an open polyline; output rounded to 3 decimals (~100 m). */
export function simplifyLine(line: Pt[], tolerance: number): Pt[] {
  if (line.length <= 2) return line.map(([x, y]) => pt(x, y));
  const keep = new Uint8Array(line.length);
  keep[0] = keep[line.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, line.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let idx = -1, dmax = 0;
    for (let i = a + 1; i < b; i++) {
      const d = segDist(line[i], line[a], line[b]);
      if (d > dmax) {
        dmax = d;
        idx = i;
      }
    }
    if (idx > 0 && dmax > tolerance) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  const out: Pt[] = [];
  for (let i = 0; i < line.length; i++) {
    if (!keep[i]) continue;
    const p = pt(line[i][0], line[i][1]);
    const prev = out[out.length - 1];
    if (!prev || prev[0] !== p[0] || prev[1] !== p[1]) out.push(p);
  }
  return out;
}

export function lineLengthKm(line: Pt[]): number {
  let km = 0;
  for (let i = 1; i < line.length; i++) km += haversineKm(line[i - 1][1], line[i - 1][0], line[i][1], line[i][0]);
  return km;
}

/** Greedy clustering: points within `km` of a cluster's first point join it. */
export function clusterPoints<T extends { lon: number; lat: number }>(items: T[], km: number): T[][] {
  const clusters: T[][] = [];
  const cell = km / 111 + 1e-9;
  const grid = new Map<string, number[]>();
  for (const it of items) {
    const cx = Math.floor(it.lon / cell), cy = Math.floor(it.lat / cell);
    let found = -1;
    for (let dx = -2; dx <= 2 && found < 0; dx++)
      for (let dy = -1; dy <= 1 && found < 0; dy++)
        for (const ci of grid.get(`${cx + dx}:${cy + dy}`) ?? []) {
          const h = clusters[ci][0];
          if (haversineKm(h.lat, h.lon, it.lat, it.lon) <= km) {
            found = ci;
            break;
          }
        }
    if (found >= 0) clusters[found].push(it);
    else {
      clusters.push([it]);
      const k = `${cx}:${cy}`;
      grid.set(k, [...(grid.get(k) ?? []), clusters.length - 1]);
    }
  }
  return clusters;
}

// ---- WRI Global Power Plant Database ---------------------------------------------

export interface PlantProps {
  /** name */
  n: string;
  /** primary fuel */
  f: string;
  /** capacity, MW */
  mw: number;
  /** country name */
  c: string;
  /** commissioning year (may be fractional upstream; rounded) */
  y: number | null;
}

export function powerPlantFeatures(csv: string, minMw = 30): PointFeature<PlantProps>[] {
  const out: PointFeature<PlantProps>[] = [];
  for (const r of csvRecords(csv)) {
    const lat = num(r.latitude), lon = num(r.longitude), mw = num(r.capacity_mw);
    const fuel = clean(r.primary_fuel) ?? "Other";
    if (!valid(lon, lat) || !Number.isFinite(mw)) continue;
    if (fuel !== "Nuclear" && mw < minMw) continue;
    const y = Number.parseFloat(r.commissioning_year);
    out.push(point(lon, lat, { n: clean(r.name) ?? "Unnamed plant", f: fuel, mw: Math.round(mw), c: clean(r.country_long) ?? "", y: Number.isFinite(y) ? Math.round(y) : null }));
  }
  // Big plants last so they draw on top.
  return out.sort((a, b) => a.properties.mw - b.properties.mw);
}

// ---- NGA World Port Index ----------------------------------------------------------

export interface PortProps {
  n: string;
  c: string;
  /** harbour size: L, M, S, V (very small) or "" */
  s: string;
  /** UN/LOCODE */
  loc: string | null;
  lng: boolean;
  oil: boolean;
}

export function portFeatures(csv: string): PointFeature<PortProps>[] {
  const size: Record<string, string> = { Large: "L", Medium: "M", Small: "S", "Very Small": "V" };
  const out: PointFeature<PortProps>[] = [];
  for (const r of csvRecords(csv)) {
    const lat = num(r.Latitude), lon = num(r.Longitude);
    if (!valid(lon, lat)) continue;
    out.push(
      point(lon, lat, {
        n: clean(r["Main Port Name"]) ?? "Unnamed port",
        c: clean(r["Country Code"]) ?? "",
        s: size[(r["Harbor Size"] ?? "").trim()] ?? "",
        loc: clean(r["UN/LOCODE"]),
        lng: r["Facilities - LNG Terminal"]?.trim() === "Yes",
        oil: r["Facilities - Oil Terminal"]?.trim() === "Yes",
      }),
    );
  }
  const rank: Record<string, number> = { L: 4, M: 3, S: 2, V: 1, "": 0 };
  return out.sort((a, b) => rank[a.properties.s] - rank[b.properties.s]);
}

// ---- OpenStreetMap (Overpass JSON) -----------------------------------------------------

export interface OsmElement {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
  geometry?: Array<{ lat: number; lon: number } | null>;
  members?: Array<{ type: string; ref: number; role: string; geometry?: Array<{ lat: number; lon: number } | null> }>;
}

const osmRef = (e: OsmElement) => `${e.type}/${e.id}`;
const osmPos = (e: OsmElement) => (e.lat !== undefined && e.lon !== undefined ? { lat: e.lat, lon: e.lon } : e.center ?? null);
const wayLine = (g: OsmElement["geometry"]): Pt[] => (g ?? []).filter((p): p is { lat: number; lon: number } => !!p).map((p) => [p.lon, p.lat]);

/** Point layer from nodes/ways/relations (`out center`), de-duplicated within `dedupKm`. */
export function osmPointFeatures<P extends { n: string | null }>(
  elements: OsmElement[],
  props: (tags: Record<string, string>) => P | null,
  dedupKm = 0.5,
): PointFeature<P & { osm: string }>[] {
  const items: Array<{ lon: number; lat: number; p: P & { osm: string } }> = [];
  for (const e of elements) {
    const pos = osmPos(e);
    if (!pos || !valid(pos.lon, pos.lat)) continue;
    const p = props(e.tags ?? {});
    if (p) items.push({ lon: pos.lon, lat: pos.lat, p: { ...p, osm: osmRef(e) } });
  }
  // Named features first so a cluster keeps the named one.
  items.sort((a, b) => Number(!a.p.n) - Number(!b.p.n));
  return clusterPoints(items, dedupKm).map((c) => point(c[0].lon, c[0].lat, c[0].p));
}

export interface DataCentreProps {
  n: string | null;
  op: string | null;
}
export const dataCentreProps = (t: Record<string, string>): DataCentreProps | null =>
  t.telecom === "data_center" ? { n: clean(t.name ?? t["name:en"]), op: clean(t.operator) } : null;

export interface BaseProps {
  n: string | null;
  /** OSM military=* value: base | naval_base */
  k: string;
  op: string | null;
}
export const baseProps = (t: Record<string, string>): BaseProps | null =>
  t.military === "base" || t.military === "naval_base" ? { n: clean(t["name:en"] ?? t.name), k: t.military, op: clean(t.operator) } : null;

const TELECOM_CATEGORY = /tele|fib|opt|communication/i;

/** Is this OSM way an underwater telecom cable? */
export function isTelecomCable(t: Record<string, string>): boolean {
  const underwater = /underwater|submarine/.test(t.location ?? "") || t.submarine === "yes" || t["seamark:type"] === "cable_submarine";
  if (!underwater || t.power) return false;
  return t.communication === "line" || t.telecom === "cable" || TELECOM_CATEGORY.test(t["seamark:cable_submarine:category"] ?? "");
}

export interface CableProps {
  n: string | null;
  op: string | null;
  km: number;
  osm: string;
}

export function cableFeatures(elements: OsmElement[], tolerance = 0.01, minKm = 1): LineFeature<CableProps>[] {
  const out: LineFeature<CableProps>[] = [];
  const seen = new Set<number>();
  for (const e of elements) {
    if (e.type !== "way" || seen.has(e.id) || !isTelecomCable(e.tags ?? {})) continue;
    seen.add(e.id);
    const raw = wayLine(e.geometry);
    const km = lineLengthKm(raw);
    if (raw.length < 2 || km < minKm) continue;
    const line = simplifyLine(raw, tolerance);
    if (line.length < 2) continue;
    const t = e.tags ?? {};
    out.push({
      type: "Feature",
      geometry: { type: "LineString", coordinates: line },
      properties: { n: clean(t.name ?? t["seamark:cable_submarine:name"] ?? t["seamark:name"]), op: clean(t.operator), km: Math.round(km), osm: osmRef(e) },
    });
  }
  return out;
}

export interface LandingProps {
  n: string | null;
  /** cable names meeting here */
  cables: string[];
  /** "station" = mapped landing station; "cable-end" = derived from a cable endpoint */
  k: "station" | "cable-end";
}

/**
 * Landing points: explicitly mapped landing stations plus cable endpoints that
 * lie on (or within a few km of) land, merged within `mergeKm`.
 */
export function landingPointFeatures(
  cables: LineFeature<CableProps>[],
  stations: OsmElement[],
  isNearLand: (lon: number, lat: number) => boolean,
  mergeKm = 5,
): PointFeature<LandingProps>[] {
  type It = { lon: number; lat: number; name: string | null; cable: string | null; station: boolean };
  const items: It[] = [];
  for (const e of stations) {
    const pos = osmPos(e);
    if (pos && valid(pos.lon, pos.lat)) items.push({ ...pos, name: clean(e.tags?.name), cable: null, station: true });
  }
  for (const c of cables) {
    if (c.properties.km < 5 || c.geometry.type !== "LineString") continue;
    const line = c.geometry.coordinates;
    for (const [lon, lat] of [line[0], line[line.length - 1]]) if (isNearLand(lon, lat)) items.push({ lon, lat, name: null, cable: c.properties.n, station: false });
  }
  items.sort((a, b) => Number(b.station) - Number(a.station));
  return clusterPoints(items, mergeKm).map((group) => {
    const head = group[0];
    const cables = [...new Set(group.map((g) => g.cable).filter((x): x is string => !!x))].sort().slice(0, 8);
    return point(head.lon, head.lat, { n: head.name, cables, k: head.station ? "station" : "cable-end" } satisfies LandingProps);
  });
}

export type PipelineSubstance = "gas" | "oil" | "products" | "unspecified";

const SUBSTANCE: Record<string, PipelineSubstance> = {
  gas: "gas", natural_gas: "gas", cng: "gas", lng: "gas", ethane: "gas",
  oil: "oil", crude_oil: "oil", crude: "oil", "gas;oil": "oil", "oil;gas": "oil", hydrocarbons: "oil", condensate: "oil",
  fuel: "products", lpg: "products", ethylene: "products", petroleum: "products", diesel: "products", kerosene: "products", gasoline: "products",
};
const GAS_NAME = /\b(gas|lng|stream)\b|gas(oducto|line)|gazoduc|erdgas|газ|gaz\b/i;
const OIL_NAME = /\b(oil|crude|petroleum)\b|oleodu|nefte|нефт|ölleitung|pipeline.*oil/i;

/** Classify a pipeline from its tags; null = not an oil/gas/fuel line (water, sewage, …). */
export function pipelineSubstance(t: Record<string, string>): PipelineSubstance | null {
  const s = (t.substance ?? t.type_of_substance ?? "").toLowerCase().trim();
  if (s) return SUBSTANCE[s] ?? null;
  const text = [t.name, t["name:en"], t.description, t.operator].filter(Boolean).join(" ");
  if (OIL_NAME.test(text)) return "oil";
  if (GAS_NAME.test(text)) return "gas";
  return null;
}

export interface PipelineProps {
  n: string | null;
  s: PipelineSubstance;
  op: string | null;
  km: number;
  osm: string;
}

/** Pipeline route relations (`out geom`) → simplified MultiLineStrings. */
export function pipelineFeatures(elements: OsmElement[], tolerance = 0.02, minKm = 10): LineFeature<PipelineProps>[] {
  const out: LineFeature<PipelineProps>[] = [];
  for (const e of elements) {
    if (e.type !== "relation") continue;
    const t = e.tags ?? {};
    const s = pipelineSubstance(t);
    if (!s) continue;
    const parts = (e.members ?? []).filter((m) => m.type === "way").map((m) => wayLine(m.geometry)).filter((l) => l.length >= 2);
    const km = parts.reduce((sum, l) => sum + lineLengthKm(l), 0);
    if (km < minKm) continue;
    const lines = parts.map((l) => simplifyLine(l, tolerance)).filter((l) => l.length >= 2);
    if (!lines.length) continue;
    out.push({
      type: "Feature",
      geometry: { type: "MultiLineString", coordinates: lines },
      properties: { n: clean(t["name:en"] ?? t.name), s, op: clean(t.operator), km: Math.round(km), osm: osmRef(e) },
    });
  }
  return out;
}

export interface LngProps {
  n: string | null;
  /** "osm" or "wpi" */
  src: string;
  c: string | null;
}

/** LNG sites: OSM terminals/tank farms merged within 5 km, plus WPI LNG ports not already covered (10 km). */
export function lngFeatures(osm: OsmElement[], ports: PointFeature<PortProps>[]): PointFeature<LngProps>[] {
  type It = { lon: number; lat: number; name: string | null; src: string; c: string | null };
  const items: It[] = [];
  for (const e of osm) {
    const pos = osmPos(e);
    const t = e.tags ?? {};
    const isLng = t.industrial === "lng_terminal" || /^lng$/i.test(t.content ?? "") || /\bLNG\b/.test(t.name ?? "");
    if (pos && isLng && valid(pos.lon, pos.lat)) items.push({ ...pos, name: clean(t["name:en"] ?? t.name), src: "osm", c: null });
  }
  items.sort((a, b) => Number(!!b.name) - Number(!!a.name));
  const sites = clusterPoints(items, 5).map((g) => ({ ...g[0], name: g.find((x) => x.name)?.name ?? null }));
  for (const p of ports) {
    if (!p.properties.lng) continue;
    const [lon, lat] = p.geometry.coordinates;
    if (sites.some((s) => haversineKm(s.lat, s.lon, lat, lon) <= 10)) continue;
    sites.push({ lon, lat, name: `${p.properties.n} (port)`, src: "wpi", c: p.properties.c });
  }
  return sites.map((s) => point(s.lon, s.lat, { n: s.name, src: s.src, c: s.c }));
}
