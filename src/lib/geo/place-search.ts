/**
 * Place search — the pure, isomorphic parts (no I/O, safe on client and server):
 *
 *  - parsing typed coordinates ("48.85, 2.35", "33.9°S 151.2°E") and IATA codes;
 *  - ranking local gazetteer candidates (countries, admin-1 regions, cities, airports);
 *  - turning a Photon (komoot) geocoder response into results;
 *  - choosing a camera view (bbox / zoom) for a result;
 *  - merging local + online results without duplicates.
 *
 * The server builds the local candidate list (src/lib/geo/place-index.ts) and
 * proxies Photon (src/app/api/geocode/route.ts); the search palette renders
 * the merged list.
 */

export type PlaceKind =
  | "continent"
  | "country"
  | "state"
  | "county"
  | "city"
  | "district"
  | "street"
  | "address"
  | "poi"
  | "airport"
  | "coordinates";

export type PlaceSource = "local" | "photon" | "input";

export type BBox = [west: number, south: number, east: number, north: number];

export interface PlaceResult {
  /** Stable key for React lists / dedupe */
  id: string;
  kind: PlaceKind;
  name: string;
  /** Second line: "State · Country", airport city, … */
  detail: string;
  lat: number;
  lon: number;
  bbox: BBox | null;
  /** ISO 3166-1 alpha-2 of the containing country, when known */
  countryCode: string | null;
  /** Feature id in /geo/regions.geojson when the place is a known admin-1 region */
  regionId: number | null;
  source: PlaceSource;
}

export interface PlaceView {
  lon: number;
  lat: number;
  zoom: number;
  bbox?: BBox;
}

export const PHOTON_ATTRIBUTION = "Search by Photon (komoot), data © OpenStreetMap contributors";
/** Online geocoding is only tried for queries at least this long. */
export const GEOCODE_MIN_CHARS = 3;

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

/** Lower-case, strip diacritics and punctuation, collapse whitespace. */
export function normalizePlace(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

// ---------------------------------------------------------------------------
// Coordinates & codes
// ---------------------------------------------------------------------------

const NUM = String.raw`[-+]?\d{1,3}(?:[.,]\d+)?`;
const DMS = String.raw`(\d{1,3})\s*°\s*(?:(\d{1,2}(?:\.\d+)?)\s*['′]\s*)?(?:(\d{1,2}(?:\.\d+)?)\s*(?:["″]|'')\s*)?`;

function dmsToDecimal(d: string, m?: string, s?: string): number {
  return Number(d) + (m ? Number(m) / 60 : 0) + (s ? Number(s) / 3600 : 0);
}

/**
 * Parse typed coordinates. Accepts "lat, lon" decimal degrees (comma, space
 * or semicolon separated), hemisphere letters ("33.87 S 151.21 E",
 * "48.85N, 2.35E") and degrees-minutes-seconds ("48°51'24\"N 2°21'3\"E").
 * Without hemisphere letters the order is latitude, longitude.
 */
export function parseCoordinates(input: string): { lat: number; lon: number } | null {
  const q = input.trim().replace(/\s+/g, " ");
  if (!q) return null;

  // Degrees/minutes/seconds with hemispheres.
  const dms = new RegExp(String.raw`^${DMS}\s*([NSns])[\s,;]*${DMS}\s*([EWew])$`).exec(q);
  if (dms) {
    const lat = dmsToDecimal(dms[1], dms[2], dms[3]) * (/s/i.test(dms[4]) ? -1 : 1);
    const lon = dmsToDecimal(dms[5], dms[6], dms[7]) * (/w/i.test(dms[8]) ? -1 : 1);
    return valid(lat, lon);
  }

  // Decimal with hemisphere letters, either order ("2.35E 48.85N" too).
  const hemi = new RegExp(String.raw`^(\d{1,3}(?:\.\d+)?)\s*°?\s*([NSEWnsew])[\s,;]+(\d{1,3}(?:\.\d+)?)\s*°?\s*([NSEWnsew])$`).exec(q);
  if (hemi) {
    const a = { v: Number(hemi[1]), h: hemi[2].toUpperCase() };
    const b = { v: Number(hemi[3]), h: hemi[4].toUpperCase() };
    const latPart = "NS".includes(a.h) ? a : b;
    const lonPart = latPart === a ? b : a;
    if (!"NS".includes(latPart.h) || !"EW".includes(lonPart.h)) return null;
    return valid(latPart.v * (latPart.h === "S" ? -1 : 1), lonPart.v * (lonPart.h === "W" ? -1 : 1));
  }

  // Plain decimals: "48.85, 2.35", "48.85 2.35", "-33.9;151.2", "48,85; 2,35" (decimal commas need a ; separator).
  const plain =
    new RegExp(String.raw`^(${NUM})\s*°?\s*;\s*(${NUM})\s*°?$`).exec(q) ??
    /^([-+]?\d{1,3}(?:\.\d+)?)\s*°?\s*(?:,\s*|\s+)([-+]?\d{1,3}(?:\.\d+)?)\s*°?$/.exec(q);
  if (plain) {
    const lat = Number(plain[1].replace(",", "."));
    const lon = Number(plain[2].replace(",", "."));
    // Two bare integers ("10 20") are more likely a typo than a place; require a decimal point somewhere.
    if (!/[.,]\d/.test(plain[1]) && !/[.,]\d/.test(plain[2])) return null;
    return valid(lat, lon);
  }
  return null;
}

function valid(lat: number, lon: number): { lat: number; lon: number } | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat: round(lat, 6), lon: round(lon, 6) };
}

const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;

export function coordinateResult(c: { lat: number; lon: number }): PlaceResult {
  const fmt = (v: number, pos: string, neg: string) => `${Math.abs(v).toFixed(4)}° ${v < 0 ? neg : pos}`;
  return {
    id: `coord:${c.lat},${c.lon}`,
    kind: "coordinates",
    name: `${fmt(c.lat, "N", "S")}, ${fmt(c.lon, "E", "W")}`,
    detail: "Coordinates",
    lat: c.lat,
    lon: c.lon,
    bbox: null,
    countryCode: null,
    regionId: null,
    source: "input",
  };
}

/** "JFK", "lhr" → "JFK"; ICAO "KJFK" → "KJFK". Null when the query can't be an airport code. */
export function airportCodeQuery(q: string): string | null {
  const t = q.trim();
  return /^[A-Za-z]{3,4}$/.test(t) ? t.toUpperCase() : null;
}

// ---------------------------------------------------------------------------
// Local ranking
// ---------------------------------------------------------------------------

export interface LocalCandidate {
  kind: Exclude<PlaceKind, "coordinates">;
  /** Display name */
  name: string;
  /** All names to match against (display name, alternates, codes) — normalised */
  keys: string[];
  /** Exact-only keys (airport codes, country codes/aliases) — normalised */
  codes?: string[];
  /** Words a "name, qualifier" query may refer to (country, state…) — normalised */
  context: string[];
  detail: string;
  lat: number;
  lon: number;
  bbox: BBox | null;
  countryCode: string | null;
  regionId: number | null;
  /** Population or a comparable importance proxy (0 if unknown) */
  weight: number;
}

const KIND_BONUS: Record<LocalCandidate["kind"], number> = {
  continent: 140,
  country: 130,
  state: 60,
  county: 40,
  city: 30,
  district: 20,
  airport: 10,
  street: 0,
  address: 0,
  poi: 0,
};

/** How well a single name matches the query (0 = no match). */
export function nameMatchScore(q: string, key: string): number {
  if (!q || !key) return 0;
  if (key === q) return 1000;
  if (key.startsWith(q)) return 600 - Math.min(150, key.length - q.length);
  if (q.length >= 3 && key.split(" ").some((w) => w.startsWith(q))) return 420;
  if (q.length >= 4 && key.includes(q)) return 250;
  return 0;
}

/**
 * Rank local candidates for a query. Supports "Name, qualifier" queries
 * ("Paris, Texas", "Springfield, IL") by requiring the qualifier to match the
 * candidate's context (country / state names and codes).
 */
export function rankLocalPlaces(query: string, candidates: readonly LocalCandidate[], limit = 6): PlaceResult[] {
  const [head, ...rest] = query.split(",");
  const q = normalizePlace(head);
  const qualifier = normalizePlace(rest.join(" "));
  if (q.length < 2) return [];
  // "JFK" typed in capitals is clearly a code; "new" in lower case is more likely the start of "New York".
  const shouting = /^[A-Z]{2,4}$/.test(head.trim());

  const scored: Array<{ c: LocalCandidate; score: number }> = [];
  for (const c of candidates) {
    let best = 0;
    if (c.codes?.includes(q)) best = c.kind === "country" ? 1100 : shouting ? (c.kind === "airport" ? 1200 : 1100) : 640;
    if (c.kind !== "airport" || q.length >= 4) for (const k of c.keys) best = Math.max(best, nameMatchScore(q, k));
    if (!best) continue;
    if (qualifier) {
      const ok = c.context.some((x) => x === qualifier || x.startsWith(qualifier) || (qualifier.length >= 3 && x.split(" ").some((w) => w.startsWith(qualifier))));
      if (!ok) continue;
      best += 200;
    }
    const score = best + KIND_BONUS[c.kind] + (c.weight > 0 ? Math.log10(c.weight) * 15 : 0);
    scored.push({ c, score });
  }
  scored.sort((a, b) => b.score - a.score);
  // Drop weak partial matches ("Paris" → "Hanover Parish") when there are strong ones.
  const floor = scored.length ? scored[0].score - 650 : 0;

  const out: PlaceResult[] = [];
  const seen = new Set<string>();
  for (const { c, score } of scored) {
    if (score < floor) break;
    const id = `local:${c.kind}:${c.countryCode ?? ""}:${normalizePlace(c.name)}:${c.lat.toFixed(1)},${c.lon.toFixed(1)}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, kind: c.kind, name: c.name, detail: c.detail, lat: c.lat, lon: c.lon, bbox: c.bbox, countryCode: c.countryCode, regionId: c.regionId, source: "local" });
    if (out.length >= limit) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Photon
// ---------------------------------------------------------------------------

export interface PhotonFeature {
  type?: string;
  geometry?: { type?: string; coordinates?: unknown };
  properties?: Record<string, unknown>;
}

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

/** Photon "type" / osm tags → our kind. */
export function photonKind(p: Record<string, unknown>): PlaceKind {
  const type = str(p.type);
  const key = str(p.osm_key);
  const value = str(p.osm_value);
  if (key === "aeroway" && (value === "aerodrome" || value === "airport")) return "airport";
  switch (type) {
    case "country":
      return "country";
    case "state":
      return "state";
    case "county":
      return "county";
    case "city":
      return "city";
    case "district":
    case "locality":
      return "district";
    case "street":
      return "street";
    case "house":
      return str(p.name) ? "poi" : "address";
  }
  if (key === "place") {
    if (value === "country") return "country";
    if (value === "state" || value === "province" || value === "region") return "state";
    if (value === "county") return "county";
    if (value === "city" || value === "town" || value === "village" || value === "municipality" || value === "hamlet") return "city";
    if (value === "suburb" || value === "neighbourhood" || value === "quarter" || value === "borough") return "district";
  }
  if (key === "boundary" && value === "administrative") return "county";
  return "poi";
}

/** Photon extent is [minLon, maxLat, maxLon, minLat]; return [w, s, e, n]. */
export function photonExtentToBBox(extent: unknown): BBox | null {
  if (!Array.isArray(extent) || extent.length !== 4 || !extent.every((v) => typeof v === "number" && Number.isFinite(v))) return null;
  const [x1, y1, x2, y2] = extent as number[];
  const w = Math.min(x1, x2), e = Math.max(x1, x2), s = Math.min(y1, y2), n = Math.max(y1, y2);
  if (Math.abs(s) > 90 || Math.abs(n) > 90 || Math.abs(w) > 180 || Math.abs(e) > 180) return null;
  return [w, s, e, n];
}

const KIND_LABEL: Record<PlaceKind, string> = {
  continent: "Region",
  country: "Country",
  state: "State / province",
  county: "County",
  city: "City",
  district: "District",
  street: "Street",
  address: "Address",
  poi: "Place",
  airport: "Airport",
  coordinates: "Coordinates",
};
export const placeKindLabel = (k: PlaceKind) => KIND_LABEL[k];

/**
 * Convert a Photon GeoJSON response into results. Malformed features are
 * skipped; identical name+kind results closer than ~1 km are collapsed.
 */
export function parsePhoton(body: unknown, limit = 8): PlaceResult[] {
  const feats = (body as { features?: unknown })?.features;
  if (!Array.isArray(feats)) return [];
  const out: PlaceResult[] = [];
  for (const f of feats as PhotonFeature[]) {
    const p = f?.properties;
    const coords = f?.geometry?.coordinates;
    if (!p || !Array.isArray(coords) || coords.length < 2) continue;
    const [lon, lat] = coords as number[];
    if (typeof lat !== "number" || typeof lon !== "number" || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    const kind = photonKind(p);
    const street = str(p.street);
    const house = str(p.housenumber);
    const name = str(p.name) ?? (street ? [house, street].filter(Boolean).join(" ") : null) ?? str(p.city) ?? str(p.state) ?? str(p.country);
    if (!name) continue;
    const cc = str(p.countrycode)?.toUpperCase() ?? null;
    const streetLine = street ? [house, street].filter(Boolean).join(" ") : null;
    const addr = (kind === "poi" || kind === "address" || kind === "airport") && streetLine !== name ? streetLine : null;
    const local = kind === "city" ? null : (str(p.city) ?? str(p.district) ?? str(p.county));
    const parts: string[] = [];
    for (const v of [addr, local, kind === "state" ? null : str(p.state), str(p.country)]) if (v && v !== name && !parts.includes(v)) parts.push(v);
    // Keep the detail line short: street, town, country (state only when there's room).
    const detailParts = parts.length > 3 ? parts.filter((_, i) => i !== 2) : parts;
    const osm = `${str(p.osm_type) ?? "?"}${typeof p.osm_id === "number" || typeof p.osm_id === "string" ? p.osm_id : `${lat},${lon}`}`;
    const r: PlaceResult = {
      id: `photon:${osm}`,
      kind,
      name,
      detail: [KIND_LABEL[kind], detailParts.join(", ")].filter(Boolean).join(" · "),
      lat,
      lon,
      bbox: photonExtentToBBox(p.extent),
      countryCode: cc,
      regionId: null,
      source: "photon",
    };
    if (out.some((o) => o.id === r.id || (o.kind === r.kind && o.name === r.name && approxKm(o, r) < 3))) continue;
    out.push(r);
    if (out.length >= limit) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Camera
// ---------------------------------------------------------------------------

/** Max zoom when fitting a bbox, and point zoom otherwise, per kind. */
const VIEW: Record<PlaceKind, { maxZoom: number; zoom: number; useBBox: boolean }> = {
  continent: { maxZoom: 3, zoom: 2.6, useBBox: false },
  country: { maxZoom: 6, zoom: 4, useBBox: true },
  state: { maxZoom: 8, zoom: 6, useBBox: true },
  county: { maxZoom: 10, zoom: 8, useBBox: true },
  city: { maxZoom: 10, zoom: 10, useBBox: false },
  district: { maxZoom: 14, zoom: 13, useBBox: true },
  street: { maxZoom: 16, zoom: 15, useBBox: true },
  address: { maxZoom: 16, zoom: 16, useBBox: false },
  poi: { maxZoom: 16, zoom: 16, useBBox: false },
  airport: { maxZoom: 14, zoom: 13, useBBox: true },
  coordinates: { maxZoom: 12, zoom: 12, useBBox: false },
};

/**
 * Camera for a place: countries/states/counties fit their bbox (capped);
 * cities fly to zoom 10; addresses and POIs to zoom 16. Large POIs (parks,
 * lakes) with a bbox wider than ~2 km fit it instead of zooming to a point.
 */
export function placeView(p: Pick<PlaceResult, "kind" | "lat" | "lon" | "bbox">): PlaceView {
  const v = VIEW[p.kind];
  const box = p.bbox && p.bbox[2] > p.bbox[0] && p.bbox[3] >= p.bbox[1] ? p.bbox : null;
  const bigPoi = (p.kind === "poi" || p.kind === "address") && box && box[2] - box[0] > 0.02;
  if (box && (v.useBBox || bigPoi)) return { lon: p.lon, lat: p.lat, zoom: v.maxZoom, bbox: box };
  return { lon: p.lon, lat: p.lat, zoom: v.zoom };
}

// ---------------------------------------------------------------------------
// Merge
// ---------------------------------------------------------------------------

const SAME_GROUP: Partial<Record<PlaceKind, string>> = { country: "country", state: "state", county: "state", city: "city", district: "city", airport: "airport" };

function approxKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const dLat = (a.lat - b.lat) * 111;
  const dLon = (a.lon - b.lon) * 111 * Math.cos(((a.lat + b.lat) / 2) * (Math.PI / 180));
  return Math.hypot(dLat, dLon);
}

/** Is `b` (online) a duplicate of `a` (local)? Same name & kind group, close together. */
export function samePlace(a: PlaceResult, b: PlaceResult): boolean {
  const ga = SAME_GROUP[a.kind] ?? a.kind;
  const gb = SAME_GROUP[b.kind] ?? b.kind;
  if (ga !== gb) return false;
  if (ga === "country") return !!a.countryCode && a.countryCode === b.countryCode;
  if (normalizePlace(a.name) !== normalizePlace(b.name)) return false;
  return approxKm(a, b) < (ga === "state" ? 300 : ga === "city" ? 40 : 5);
}

/** Coordinates first, then local results, then online results that add something new. */
export function mergePlaces(local: readonly PlaceResult[], online: readonly PlaceResult[], limit = 10): PlaceResult[] {
  const out: PlaceResult[] = [...local];
  for (const r of online) if (!out.some((o) => o.id === r.id || samePlace(o, r))) out.push(r);
  return out.slice(0, limit);
}
