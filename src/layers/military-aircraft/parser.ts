/**
 * adsb.lol /v2/mil response (readsb "aircraft.json"-style, subset).
 * https://api.adsb.lol/docs
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
  /** barometric altitude in feet, or "ground" */
  alt_baro?: number | string;
  alt_geom?: number;
  /** ground speed, knots */
  gs?: number;
  track?: number;
  lat?: number;
  lon?: number;
  squawk?: string;
  /** seconds since the last position */
  seen_pos?: number;
}

/** [hex, callsign, registration, typeCode, lon, lat, altFt (null = n/a), onGround, groundSpeedKt, trackDeg, squawk, positionAgeSec] */
export type MilRow = [string, string, string, string, number, number, number | null, boolean, number | null, number | null, string, number];

export interface MilitaryAircraftData {
  fields: string[];
  rows: MilRow[];
}

const fin = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** Aircraft with a usable position, at most `maxAgeSec` old. */
export function parseAdsbLolMil(raw: AdsbLolResponse, maxAgeSec = 120): MilRow[] {
  const out: MilRow[] = [];
  for (const a of raw?.ac ?? []) {
    const hex = str(a?.hex).toLowerCase();
    if (!hex || !fin(a.lat) || !fin(a.lon) || Math.abs(a.lat) > 90 || Math.abs(a.lon) > 180) continue;
    const age = fin(a.seen_pos) ? a.seen_pos : 0;
    if (age > maxAgeSec) continue;
    const onGround = a.alt_baro === "ground";
    const alt = fin(a.alt_baro) ? a.alt_baro : fin(a.alt_geom) ? a.alt_geom : null;
    out.push([
      hex,
      str(a.flight),
      str(a.r),
      str(a.t),
      Math.round(a.lon * 1e4) / 1e4,
      Math.round(a.lat * 1e4) / 1e4,
      onGround ? 0 : alt,
      onGround,
      fin(a.gs) ? Math.round(a.gs) : null,
      fin(a.track) ? Math.round(a.track) : null,
      str(a.squawk),
      Math.round(age),
    ]);
  }
  return out;
}
