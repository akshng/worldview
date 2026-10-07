/**
 * Local place index for search: countries, continental regions, admin-1
 * states/provinces (ids match /geo/regions.geojson, so the region panel can
 * open them), cities and airports — all from bundled data, no network.
 */
import "server-only";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import regionsData from "@/data/geo/regions.json";
import { AIRPORTS, CITIES, COUNTRIES, COUNTRY_ALIASES, US_STATE_ABBR, getCountry } from "./gazetteer";
import { normalizePlace, rankLocalPlaces, type BBox, type LocalCandidate, type PlaceResult } from "./place-search";

/** Continental groupings used by the event filters (Country.region), with typed aliases. */
export const CONTINENT_ALIASES: Record<string, string> = {
  europe: "Europe",
  "middle east": "Middle East",
  mideast: "Middle East",
  africa: "Africa",
  asia: "Asia",
  "latin america": "Latin America",
  "south america": "Latin America",
  "central america": "Latin America",
  "north america": "North America",
  oceania: "Oceania",
  pacific: "Oceania",
};

interface RegionRow { n: string[]; a: string[]; c: string; lat: number; lon: number; t: string | null }
const REGIONS = regionsData as unknown as RegionRow[];

type RegionShape = { name: string; bbox: BBox };

/**
 * Display names and bboxes of admin-1 regions from public/geo/regions.geojson
 * (feature id = row index + 1 in regions.json). Read once, lazily; if the file
 * is unavailable regions still work with their label point.
 */
function regionShapes(): Map<number, RegionShape> {
  const g = globalThis as unknown as { __wvRegionShapes?: Map<number, RegionShape> };
  if (g.__wvRegionShapes) return g.__wvRegionShapes;
  const out = new Map<number, RegionShape>();
  try {
    const fc = JSON.parse(readFileSync(join(process.cwd(), "public/geo/regions.geojson"), "utf8")) as {
      features: Array<{ id: number; properties: { name: string }; geometry: { type: string; coordinates: unknown } }>;
    };
    for (const f of fc.features) {
      let w = 180, s = 90, e = -180, n = -90;
      const polys = (f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates) as number[][][][];
      for (const poly of polys) for (const [x, y] of poly[0]) {
        if (x < w) w = x;
        if (x > e) e = x;
        if (y < s) s = y;
        if (y > n) n = y;
      }
      out.set(Number(f.id), { name: f.properties.name, bbox: [w, s, e, n] });
    }
  } catch (err) {
    console.warn("[places] regions.geojson unavailable — region bboxes disabled:", (err as Error).message);
  }
  g.__wvRegionShapes = out;
  return out;
}

const usAbbrByState = new Map(Object.entries(US_STATE_ABBR).map(([abbr, name]) => [name, abbr]));
const uniq = (xs: Array<string | null | undefined>) => [...new Set(xs.filter((x): x is string => !!x).map(normalizePlace).filter(Boolean))];

let candidates: LocalCandidate[] | null = null;
/** region key "CC|normalised name" → region ids (primary-name matches first) */
let regionKeys: Map<string, number[]> | null = null;

function build(): LocalCandidate[] {
  if (candidates) return candidates;
  const out: LocalCandidate[] = [];
  const shapes = regionShapes();

  // Continents / macro regions
  const continentNames = [...new Set(Object.values(CONTINENT_ALIASES))];
  for (const name of continentNames) {
    const members = COUNTRIES.filter((c) => c.region === name);
    if (!members.length) continue;
    let w = 0, x = 0, y = 0;
    for (const c of members) {
      const p = Math.sqrt(Math.max(c.population, 1));
      w += p;
      x += c.label[0] * p;
      y += c.label[1] * p;
    }
    out.push({
      kind: "continent",
      name,
      keys: uniq([name, ...Object.entries(CONTINENT_ALIASES).filter(([, v]) => v === name).map(([k]) => k)]),
      context: [],
      detail: `Region · ${members.length} countries`,
      lat: y / w,
      lon: x / w,
      bbox: null,
      countryCode: null,
      regionId: null,
      weight: 0,
    });
  }

  // Countries (first entry per code — NE repeats some codes for territories)
  const seen = new Set<string>();
  for (const c of COUNTRIES) {
    if (seen.has(c.code)) continue;
    seen.add(c.code);
    const aliases = Object.entries(COUNTRY_ALIASES).filter(([, code]) => code === c.code).map(([a]) => a);
    out.push({
      kind: "country",
      // Natural Earth abbreviates a few short names ("S. Geo. and the Is.")
      name: c.name.includes(".") ? c.nameLong : c.name,
      keys: uniq([c.name, c.nameLong, ...aliases.filter((a) => a.length > 3)]),
      codes: uniq([c.iso3, ...aliases.filter((a) => a.length <= 3)]),
      context: uniq([c.subregion, c.region]),
      detail: ["Country", [c.subregion, c.region].filter(Boolean).join(", ")].filter(Boolean).join(" · "),
      lat: c.label[1],
      lon: c.label[0],
      bbox: c.bbox,
      countryCode: c.code,
      regionId: null,
      weight: c.population,
    });
  }

  // Admin-1 regions (states / provinces)
  regionKeys = new Map();
  REGIONS.forEach((r, i) => {
    const id = i + 1;
    const shape = shapes.get(id);
    const country = getCountry(r.c);
    const name = shape?.name ?? r.n[0] ?? r.a[0];
    if (!name) return;
    const primary = uniq([name, ...r.n]);
    const alt = uniq(r.a).filter((a) => !primary.includes(a) && !/\d/.test(a));
    for (const [keys, isPrimary] of [[primary, true], [alt, false]] as const) {
      for (const k of keys) {
        const key = `${r.c}|${k}`;
        const ids = regionKeys!.get(key) ?? [];
        if (isPrimary) ids.unshift(id);
        else ids.push(id);
        regionKeys!.set(key, ids);
      }
    }
    const abbr = r.c === "US" ? usAbbrByState.get(name) : undefined;
    out.push({
      kind: "state",
      name,
      keys: primary,
      codes: abbr ? [abbr.toLowerCase()] : undefined,
      context: uniq([country?.name, country?.nameLong, r.c, country?.iso3]),
      detail: [r.t ?? "Region", country?.name].filter(Boolean).join(" · "),
      lat: r.lat,
      lon: r.lon,
      bbox: shape?.bbox ?? null,
      countryCode: r.c,
      regionId: shape ? id : null,
      weight: 0,
    });
  });

  // Cities
  for (const c of CITIES) {
    const abbr = c.country === "US" && c.admin1 ? usAbbrByState.get(c.admin1) : undefined;
    out.push({
      kind: "city",
      name: c.name,
      keys: uniq([c.name]),
      context: uniq([c.countryName, c.country, getCountry(c.country)?.iso3, c.admin1, abbr]),
      detail: ["City", [c.admin1, c.countryName].filter(Boolean).join(", ")].join(" · "),
      lat: c.lat,
      lon: c.lon,
      bbox: null,
      countryCode: c.country,
      regionId: null,
      weight: c.population,
    });
  }

  // Airports: codes (IATA / ICAO) and names
  for (const a of AIRPORTS) {
    const country = getCountry(a.country);
    out.push({
      kind: "airport",
      name: a.name,
      keys: uniq([a.name, a.name.replace(/\b(international|airport|aeropuerto|aeroport|flughafen)\b/gi, "")]),
      codes: uniq([a.iata, a.icao]),
      context: uniq([a.city, country?.name, a.country]),
      detail: [`Airport ${a.iata}`, [a.city, country?.name ?? a.country].filter(Boolean).join(", ")].join(" · "),
      lat: a.lat,
      lon: a.lon,
      bbox: null,
      countryCode: a.country,
      regionId: null,
      weight: a.large ? 1_000_000 : 10_000,
    });
  }
  candidates = out;
  return out;
}

/** Instant local place results for a query (no network). */
export function searchPlacesLocal(query: string, limit = 6): PlaceResult[] {
  return rankLocalPlaces(query, build(), limit);
}

/** Admin-1 region id (regions.geojson feature id) for a state/province name within a country. */
export function findRegionId(name: string, countryCode: string | null): number | null {
  if (!countryCode) return null;
  build();
  const cc = countryCode.toUpperCase();
  const n = normalizePlace(name);
  // "Kyiv Oblast" → "kyiv", "Tokyo Prefecture" → "tokyo", "State of Mexico" → "mexico"
  const bare = n
    .replace(/\b(oblast|province|provincia|state|region|prefecture|governorate|county|department|district|of|the)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const ids = regionKeys?.get(`${cc}|${n}`) ?? (bare && bare !== n ? regionKeys?.get(`${cc}|${bare}`) : undefined);
  return ids?.length ? ids[0] : null;
}

/** Make online results open our panels: Photon countries → country panel, states → region panel. */
export function enrichOnlineResults(results: PlaceResult[]): PlaceResult[] {
  return results.map((r) => {
    if (r.kind === "country") return getCountry(r.countryCode) ? r : { ...r, countryCode: null };
    if (r.kind === "state") return { ...r, regionId: findRegionId(r.name, r.countryCode) };
    return r;
  });
}
