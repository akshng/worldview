/**
 * adsb.lol v2 responses (readsb "aircraft.json" style) → compact rows for the
 * map, plus viewport → query-cell planning. Pure functions (unit-tested).
 * https://api.adsb.lol/docs — data under ODbL 1.0.
 */

export interface AdsbLolResponse {
  ac?: AdsbLolAircraft[];
  now?: number;
  total?: number;
}

export interface AdsbLolAircraft {
  hex?: string;
  flight?: string;
  /** registration */
  r?: string;
  /** ICAO type designator */
  t?: string;
  /** long type description (some endpoints) */
  desc?: string;
  /** owner / operator (some endpoints) */
  ownOp?: string;
  year?: string;
  /** bit 0: military, 1: interesting, 2: PIA, 3: LADD */
  dbFlags?: number;
  /** barometric altitude in feet, or "ground" */
  alt_baro?: number | string;
  alt_geom?: number;
  /** ground speed, knots */
  gs?: number;
  tas?: number;
  ias?: number;
  mach?: number;
  track?: number;
  true_heading?: number;
  mag_heading?: number;
  baro_rate?: number;
  geom_rate?: number;
  nav_altitude_mcp?: number;
  nav_altitude_fms?: number;
  category?: string;
  emergency?: string;
  lat?: number;
  lon?: number;
  squawk?: string;
  /** seconds since the last position */
  seen_pos?: number;
  seen?: number;
  /** "adsb_icao", "mlat", "tisb_icao", "mode_s", … */
  type?: string;
}

/** [hex, callsign, registration, typeCode, lon, lat, altFt (null = n/a), onGround, groundSpeedKt, trackDeg, squawk, positionAgeSec, military] */
export type AirRow = [string, string, string, string, number, number, number | null, boolean, number | null, number | null, string, number, boolean];

export interface AircraftData {
  fields: string[];
  rows: AirRow[];
}

export const AIR_FIELDS = ["hex", "callsign", "registration", "type", "lon", "lat", "alt_ft", "on_ground", "gs_kt", "track_deg", "squawk", "position_age_s", "military"];

const fin = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** Transmitters that are not aircraft: towers, ground vehicles, obstacles (ADS-B category C*). */
const NOT_AIRCRAFT_TYPES = new Set(["TWR", "GND", "SERV", "EMER", "BALL"]);
export const isNotAircraft = (a: AdsbLolAircraft) => /^C\d/.test(str(a.category).toUpperCase()) || NOT_AIRCRAFT_TYPES.has(str(a.t).toUpperCase());

/** One aircraft → row, or null without a usable fresh position (or when it is a ground transmitter). */
export function adsbLolRow(a: AdsbLolAircraft, maxAgeSec = 120): AirRow | null {
  const hex = str(a?.hex).toLowerCase();
  if (!hex || !fin(a.lat) || !fin(a.lon) || Math.abs(a.lat) > 90 || Math.abs(a.lon) > 180) return null;
  if (isNotAircraft(a)) return null;
  const age = fin(a.seen_pos) ? a.seen_pos : 0;
  if (age > maxAgeSec) return null;
  const onGround = a.alt_baro === "ground";
  const alt = fin(a.alt_baro) ? a.alt_baro : fin(a.alt_geom) ? a.alt_geom : null;
  const track = fin(a.track) ? a.track : fin(a.true_heading) ? a.true_heading : fin(a.mag_heading) ? a.mag_heading : null;
  return [
    hex,
    str(a.flight),
    str(a.r),
    str(a.t),
    Math.round(a.lon * 1e4) / 1e4,
    Math.round(a.lat * 1e4) / 1e4,
    onGround ? 0 : alt,
    onGround,
    fin(a.gs) ? Math.round(a.gs) : null,
    track === null ? null : Math.round(track),
    str(a.squawk),
    Math.round(age),
    fin(a.dbFlags) && (a.dbFlags & 1) === 1,
  ];
}

/** Aircraft with a usable position, at most `maxAgeSec` old, de-duplicated by hex. */
export function parseAdsbLol(raw: AdsbLolResponse, maxAgeSec = 120): AirRow[] {
  const out = new Map<string, AirRow>();
  for (const a of raw?.ac ?? []) {
    const r = adsbLolRow(a, maxAgeSec);
    if (r && (!out.has(r[0]) || out.get(r[0])![11] > r[11])) out.set(r[0], r);
  }
  return [...out.values()];
}

// ---- viewport → query cells -------------------------------------------------

/** Cell edge in degrees: each cell is fetched as one adsb.lol point/radius query. */
export const CELL_DEG = 6;
/** adsb.lol's maximum query radius */
export const MAX_RADIUS_NM = 250;

export interface QueryCell {
  key: string;
  lat: number;
  lon: number;
  radiusNm: number;
  bbox: [number, number, number, number];
}

/** The query circle for cell (i, j): centred, radius covering the cell (capped). */
export function cellQuery(i: number, j: number): QueryCell {
  const s = i * CELL_DEG, w = j * CELL_DEG;
  const lat = s + CELL_DEG / 2, lon = w + CELL_DEG / 2;
  const halfLatNm = (CELL_DEG / 2) * 60;
  const halfLonNm = (CELL_DEG / 2) * 60 * Math.cos((Math.min(Math.abs(s), Math.abs(s + CELL_DEG)) * Math.PI) / 180);
  const radiusNm = Math.min(MAX_RADIUS_NM, Math.ceil(Math.hypot(halfLatNm, halfLonNm)));
  return { key: `${i}:${j}`, lat, lon, radiusNm, bbox: [w, s, w + CELL_DEG, s + CELL_DEG] };
}

/**
 * Rough air-traffic density of a cell centre (0–3), used to choose which cells
 * to load when the view is too wide to load them all: busy airspace first,
 * rather than empty ocean in the middle of the view.
 */
export function trafficWeight(lat: number, lon: number): number {
  const inBox = (w: number, s: number, e: number, n: number) => lon >= w && lon <= e && lat >= s && lat <= n;
  if (inBox(-10, 36, 30, 60) || inBox(-125, 25, -70, 50)) return 3; // Europe, contiguous US
  if (inBox(100, 18, 145, 45) || inBox(-130, 50, -60, 60)) return 2; // East Asia, Canada
  if (inBox(35, 10, 80, 38) || inBox(95, -10, 125, 18) || inBox(140, -40, 155, -25) || inBox(-80, -35, -35, 0) || inBox(-120, 14, -85, 25)) return 1;
  return 0;
}

/**
 * Cells covering a viewport bbox [west, south, east, north] (east < west =
 * crosses the antimeridian), at most `max`: nearest the centre first, or —
 * when the view needs more than `max` — the busiest airspace first.
 */
export function viewportCells(bbox: [number, number, number, number], max = 12): { cells: QueryCell[]; truncated: boolean } {
  let [w, s, e, n] = bbox;
  s = Math.max(-84, Math.min(84, s));
  n = Math.max(-84, Math.min(84, n));
  if (![w, s, e, n].every(Number.isFinite) || n <= s) return { cells: [], truncated: false };
  if (e < w) e += 360;
  if (e - w >= 360) [w, e] = [-180, 180];
  const cLat = (s + n) / 2, cLon = (w + e) / 2;
  const all: Array<{ i: number; j: number; d: number }> = [];
  const i0 = Math.floor(s / CELL_DEG), i1 = Math.floor((n - 1e-9) / CELL_DEG);
  const j0 = Math.floor(w / CELL_DEG), j1 = Math.floor((e - 1e-9) / CELL_DEG);
  for (let i = i0; i <= i1; i++)
    for (let j = j0; j <= j1; j++) {
      const la = (i + 0.5) * CELL_DEG, lo = (j + 0.5) * CELL_DEG;
      const d = Math.hypot(la - cLat, (lo - cLon) * Math.cos((cLat * Math.PI) / 180));
      all.push({ i, j, d });
    }
  const truncated = all.length > max;
  // Wide view: prefer busy airspace (then nearness), so a zoomed-out globe isn't just empty ocean.
  const w8 = (c: { i: number; j: number }) => (truncated ? trafficWeight((c.i + 0.5) * CELL_DEG, ((((c.j + 0.5) * CELL_DEG + 180) % 360) + 360) % 360 - 180) : 0);
  all.sort((a, b) => w8(b) - w8(a) || a.d - b.d);
  const seen = new Set<string>();
  const cells: QueryCell[] = [];
  for (const { i, j } of all) {
    // wrap longitudes into [-180, 180)
    const per = 360 / CELL_DEG;
    const jj = ((((j + per / 2) % per) + per) % per) - per / 2;
    const c = cellQuery(i, jj);
    if (seen.has(c.key)) continue;
    seen.add(c.key);
    if (cells.length >= max) return { cells, truncated: true };
    cells.push(c);
  }
  return { cells, truncated };
}

/** Rows inside a bbox (east < west = crosses the antimeridian). */
export function inBbox(lon: number, lat: number, [w, s, e, n]: [number, number, number, number]): boolean {
  if (lat < s || lat > n) return false;
  return e >= w ? lon >= w && lon <= e : lon >= w || lon <= e;
}
