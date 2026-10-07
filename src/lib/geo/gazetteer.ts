/**
 * Server-side gazetteer built from bundled Natural Earth data
 * (see scripts/build-geo-data.ts). Provides reverse geocoding, nearest-place
 * lookup and location search without any external geocoding service.
 */
import "server-only";
import countriesData from "@/data/geo/countries.json";
import citiesData from "@/data/geo/cities.json";
import airportsData from "@/data/geo/airports.json";
import regionsData from "@/data/geo/regions.json";
import { bboxContains, haversineKm, pointInGeometry, type BBox, type PolygonalGeometry } from "./math";

export interface Country {
  code: string;
  iso3: string;
  name: string;
  nameLong: string;
  continent: string;
  subregion: string;
  region: string;
  population: number;
  label: [number, number];
  bbox: BBox;
  geometry: PolygonalGeometry;
}

export interface City {
  name: string;
  country: string | null;
  countryName: string;
  admin1: string | null;
  lat: number;
  lon: number;
  population: number;
  capital: boolean;
}

export interface Airport {
  iata: string;
  icao: string | null;
  name: string;
  city: string | null;
  country: string;
  lat: number;
  lon: number;
  large: boolean;
}

export const COUNTRIES = countriesData as unknown as Country[];
export const AIRPORTS = airportsData as unknown as Airport[];
const airportIndex = new Map<string, Airport>();
for (const a of AIRPORTS) {
  airportIndex.set(a.iata.toUpperCase(), a);
  if (a.icao) airportIndex.set(a.icao.toUpperCase(), a);
}
/** Look up an airport by IATA ("BOS") or ICAO ("KBOS") code. FAA uses IATA-style codes for US airports. */
export function airportByCode(code: string): Airport | undefined {
  const c = code.trim().toUpperCase();
  return airportIndex.get(c) ?? (c.length === 3 ? airportIndex.get(`K${c}`) : undefined);
}

export const US_STATE_ABBR: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware",
  DC: "District of Columbia", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa",
  KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota",
  MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey",
  NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon",
  PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah",
  VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming", PR: "Puerto Rico",
};
export function usStateName(abbr: string): string | null {
  return US_STATE_ABBR[abbr.toUpperCase()] ?? null;
}

/**
 * Best point for "City, ST/Country" style addresses: a known city, else the
 * centre of the state's known cities, else the country label point.
 */
export function locateAddress(city: string | null, stateOrCountry: string | null): { lat: number; lon: number; precision: "city" | "region" | "country"; label: string } | null {
  const sc = (stateOrCountry ?? "").toUpperCase();
  const state = usStateName(sc);
  const country = state ? getCountry("US") : getCountry(sc) ?? findCountryByName(stateOrCountry ?? "");
  if (!country) return null;
  const cityName = city?.trim().toLowerCase();
  if (cityName) {
    const match = CITIES.find(
      (c) => c.name.toLowerCase() === cityName && c.country === country.code && (!state || !c.admin1 || c.admin1.toLowerCase() === state.toLowerCase()),
    );
    if (match) return { lat: match.lat, lon: match.lon, precision: "city", label: `${match.name}, ${state ?? country.name}` };
    const ap = AIRPORTS.find((a) => a.city?.toLowerCase() === cityName && a.country === country.code);
    if (ap) return { lat: ap.lat, lon: ap.lon, precision: "city", label: `${ap.city}, ${state ?? country.name}` };
  }
  if (state) {
    const cs = CITIES.filter((c) => c.country === "US" && c.admin1?.toLowerCase() === state.toLowerCase());
    if (cs.length) return { lat: cs.reduce((s, c) => s + c.lat, 0) / cs.length, lon: cs.reduce((s, c) => s + c.lon, 0) / cs.length, precision: "region", label: `${city ? `${city}, ` : ""}${state}` };
  }
  return { lat: country.label[1], lon: country.label[0], precision: "country", label: `${city ? `${city}, ` : ""}${country.name}` };
}
export const CITIES = citiesData as unknown as City[];

const byCode = new Map<string, Country>();
const byIso3 = new Map<string, Country>();
for (const c of COUNTRIES) {
  // Some territories share codes in NE; keep the first (sovereign) entry.
  if (!byCode.has(c.code)) byCode.set(c.code, c);
  if (!byIso3.has(c.iso3)) byIso3.set(c.iso3, c);
}

export function getCountry(code: string | null | undefined): Country | undefined {
  if (!code) return undefined;
  const up = code.toUpperCase();
  return up.length === 3 ? byIso3.get(up) : byCode.get(up);
}

const nameIndex = new Map<string, Country>();
for (const c of COUNTRIES) {
  for (const n of [c.name, c.nameLong]) nameIndex.set(n.toLowerCase(), c);
}
export const COUNTRY_ALIASES: Record<string, string> = {
  "united states": "US", usa: "US", "u.s.": "US", "us": "US", america: "US",
  uk: "GB", "united kingdom": "GB", britain: "GB", "great britain": "GB", england: "GB",
  russia: "RU", "south korea": "KR", "north korea": "KP", iran: "IR", syria: "SY",
  "czech republic": "CZ", "ivory coast": "CI", "drc": "CD", "dr congo": "CD", uae: "AE",
  burma: "MM", vietnam: "VN", laos: "LA", turkey: "TR", "türkiye": "TR", palestine: "PS",
};

export function findCountryByName(name: string): Country | undefined {
  const k = name.trim().toLowerCase();
  if (!k) return undefined;
  const alias = COUNTRY_ALIASES[k];
  if (alias) return byCode.get(alias);
  return nameIndex.get(k);
}

export interface ReverseGeocodeResult {
  country: Country | null;
  /** True when the point lies outside every polygon and the nearest country was used */
  approximate: boolean;
  distanceKm: number;
}

/**
 * Point → country. Falls back to the nearest country label point within
 * `maxFallbackKm` (useful for offshore earthquakes and coastal points that the
 * 1:50m polygons miss).
 */
export function reverseGeocode(lat: number, lon: number, maxFallbackKm = 250): ReverseGeocodeResult {
  for (const c of COUNTRIES) {
    if (!bboxContains(c.bbox, lat, lon)) continue;
    if (pointInGeometry(lon, lat, c.geometry)) return { country: c, approximate: false, distanceKm: 0 };
  }
  // Nearest city is a better proxy for coastline distance than country label points.
  const near = nearestCity(lat, lon);
  if (near && near.distanceKm <= maxFallbackKm && near.city.country) {
    const c = getCountry(near.city.country);
    if (c) return { country: c, approximate: true, distanceKm: near.distanceKm };
  }
  return { country: null, approximate: true, distanceKm: Infinity };
}

export function nearestCity(lat: number, lon: number): { city: City; distanceKm: number } | null {
  let best: City | null = null;
  let bestD = Infinity;
  for (const c of CITIES) {
    if (Math.abs(c.lat - lat) > 15) continue;
    const d = haversineKm(lat, lon, c.lat, c.lon);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best ? { city: best, distanceKm: bestD } : null;
}

/** "62 km NE of Sendai" style label for places without a published location name. */
export function describeNearest(lat: number, lon: number, maxKm = 400): string | null {
  const near = nearestCity(lat, lon);
  if (!near || near.distanceKm > maxKm) return null;
  if (near.distanceKm < 10) return `${near.city.name}, ${near.city.countryName}`;
  return `${Math.round(near.distanceKm)} km ${bearingLabel(near.city.lat, near.city.lon, lat, lon)} of ${near.city.name}, ${near.city.countryName}`;
}

function bearingLabel(lat1: number, lon1: number, lat2: number, lon2: number): string {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const y = Math.sin(toRad(lon2 - lon1)) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lon2 - lon1));
  const brng = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  return ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(brng / 45) % 8];
}

// ---------------------------------------------------------------------------
// Admin-1 regions (states / provinces)
// ---------------------------------------------------------------------------
interface RegionRow { n: string[]; a: string[]; c: string; lat: number; lon: number; t: string | null }
const REGIONS = regionsData as unknown as RegionRow[];

const norm = (s: string) => s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
const regionIndex = new Map<string, Array<{ c: string; lat: number; lon: number; primary: boolean; label: string }>>();
for (const r of REGIONS) {
  for (const [names, primary] of [[r.n, true], [r.a, false]] as const) {
    for (const name of names) {
      const k = `${r.c}|${norm(name)}`;
      const list = regionIndex.get(k) ?? [];
      list.push({ c: r.c, lat: r.lat, lon: r.lon, primary, label: r.n[0] ?? name });
      regionIndex.set(k, list);
    }
  }
}

/** A country's admin-1 regions: primary names (incl. romanisation variants) and label point. */
export function regionsOf(iso2: string): Array<{ names: string[]; lat: number; lon: number }> {
  const c = iso2.toUpperCase();
  return REGIONS.filter((r) => r.c === c && r.n.length).map((r) => ({ names: r.n, lat: r.lat, lon: r.lon }));
}

/**
 * Find a state/province (or a larger region named in several provinces'
 * alternate names, e.g. "Lombardy") within a country. Multi-province matches
 * resolve to the average of their label points (region-level).
 */
export function findRegion(name: string, iso2: string): { lat: number; lon: number; label: string } | null {
  const hits = regionIndex.get(`${iso2.toUpperCase()}|${norm(name)}`);
  if (!hits?.length) return null;
  const primary = hits.filter((h) => h.primary);
  const use = primary.length === 1 ? primary : hits;
  return { lat: use.reduce((s, h) => s + h.lat, 0) / use.length, lon: use.reduce((s, h) => s + h.lon, 0) / use.length, label: name };
}

/** Region names (length ≥ 4) mentioned anywhere in a text, for a given country. */
export function regionsInText(text: string, iso2: string): Array<{ lat: number; lon: number; label: string }> {
  const t = ` ${norm(text)} `;
  const out: Array<{ lat: number; lon: number; label: string }> = [];
  const seen = new Set<string>();
  for (const key of regionIndex.keys()) {
    if (!key.startsWith(`${iso2.toUpperCase()}|`)) continue;
    const name = key.slice(3);
    if (name.length < 4 || seen.has(name)) continue;
    if (new RegExp(`[^a-z]${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^a-z]`).test(t)) {
      const r = findRegion(name, iso2);
      if (r) {
        seen.add(name);
        out.push(r);
      }
    }
  }
  return out;
}
