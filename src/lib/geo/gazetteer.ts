/**
 * Server-side gazetteer built from bundled Natural Earth data
 * (see scripts/build-geo-data.ts). Provides reverse geocoding, nearest-place
 * lookup and location search without any external geocoding service.
 */
import "server-only";
import countriesData from "@/data/geo/countries.json";
import citiesData from "@/data/geo/cities.json";
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

export const COUNTRIES = countriesData as unknown as Country[];
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
const ALIASES: Record<string, string> = {
  "united states": "US", usa: "US", "u.s.": "US", "us": "US", america: "US",
  uk: "GB", "united kingdom": "GB", britain: "GB", "great britain": "GB", england: "GB",
  russia: "RU", "south korea": "KR", "north korea": "KP", iran: "IR", syria: "SY",
  "czech republic": "CZ", "ivory coast": "CI", "drc": "CD", "dr congo": "CD", uae: "AE",
  burma: "MM", vietnam: "VN", laos: "LA", turkey: "TR", "türkiye": "TR", palestine: "PS",
};

export function findCountryByName(name: string): Country | undefined {
  const k = name.trim().toLowerCase();
  if (!k) return undefined;
  const alias = ALIASES[k];
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
