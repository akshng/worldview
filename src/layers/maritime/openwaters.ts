/**
 * Open Waters AIS (https://openwaters.io/ais/) — a free AIS aggregator
 * (AISHub, aisstream.io, volunteer receivers, coastal authorities) with an
 * anonymous, keyless HTTP snapshot: GET /v1/vessels?bbox=latMin,lonMin,latMax,lonMax
 * (GeoJSON, at most 10° × 10° per request for anonymous clients). Data keeps
 * each upstream source's terms; the response carries the credit lines.
 *
 * Pure parsing / planning helpers here (unit-tested); fetching lives in
 * ./viewport.ts.
 */
import type { VesselRow, VesselStatic } from "./types";
import { aisDimensions, etaFromParts } from "./mid";

export const OPENWATERS_ATTRIBUTION = "Open Waters AIS (openwaters.io/ais) — AISHub, aisstream.io and volunteer receivers";
/** Anonymous tier: the request box may span at most 10° in each direction. */
export const OW_CELL_DEG = 10;

export interface OpenWatersFeature {
  geometry?: { type?: string; coordinates?: [number, number] };
  id?: number;
  properties?: {
    mmsi?: number;
    kind?: string;
    name?: string;
    callsign?: string;
    imo?: number;
    type?: number;
    flag?: string;
    sog?: number;
    cog?: number;
    heading?: number;
    nav_status?: number;
    destination?: string;
    /** "MM-DD HH:MM" (UTC) */
    eta?: string;
    draught?: number;
    length?: number;
    beam?: number;
    to_bow?: number;
    to_stern?: number;
    to_port?: number;
    to_starboard?: number;
    /** ISO time of the last position */
    seen?: string;
    source?: string;
  };
}

export interface OpenWatersResponse {
  features?: OpenWatersFeature[];
  truncated?: boolean;
  attribution?: Record<string, string>;
}

const fin = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const txt = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);

/** "MM-DD HH:MM" → ISO, or null. */
export function parseOwEta(s: string | undefined, now = Date.now()): string | null {
  const m = /^(\d\d)-(\d\d) (\d\d):(\d\d)$/.exec(s?.trim() ?? "");
  return m ? etaFromParts(+m[1], +m[2], +m[3], +m[4], now) : null;
}

/** Vessels (not aids to navigation / base stations) → rows plus static data, dropping positions older than maxAgeMs. */
export function parseOpenWaters(raw: OpenWatersResponse, maxAgeMs = 60 * 60_000, now = Date.now()): Array<{ row: VesselRow; static: VesselStatic; source: string }> {
  const out: Array<{ row: VesselRow; static: VesselStatic; source: string }> = [];
  for (const f of raw?.features ?? []) {
    const p = f?.properties ?? {};
    if (p.kind && p.kind !== "vessel") continue;
    const mmsi = fin(p.mmsi) ? p.mmsi : fin(f.id) ? f.id : null;
    const c = f?.geometry?.coordinates;
    if (mmsi === null || !Array.isArray(c)) continue;
    const [lon, lat] = c;
    if (!fin(lon) || !fin(lat) || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    const t = Date.parse(p.seen ?? "");
    const at = Number.isFinite(t) ? t : now;
    if (now - at > maxAgeMs) continue;
    const type = fin(p.type) && p.type > 0 && p.type < 100 ? p.type : null;
    const dest = txt(p.destination) ?? null;
    out.push({
      row: [
        mmsi,
        txt(p.name) ?? "",
        Math.round(lon * 1e4) / 1e4,
        Math.round(lat * 1e4) / 1e4,
        fin(p.sog) && p.sog < 102.3 ? p.sog : null,
        fin(p.cog) && p.cog < 360 ? p.cog : null,
        fin(p.heading) && p.heading < 360 ? p.heading : null,
        fin(p.nav_status) && p.nav_status < 15 ? p.nav_status : null,
        at,
        type,
        dest,
      ],
      static: {
        name: txt(p.name),
        imo: fin(p.imo) && p.imo > 0 ? p.imo : null,
        callSign: txt(p.callsign),
        shipType: type,
        destination: dest ?? undefined,
        eta: parseOwEta(p.eta, now),
        draughtM: fin(p.draught) && p.draught > 0 ? p.draught : null,
        ...(fin(p.to_bow) ? aisDimensions(p.to_bow, p.to_stern, p.to_port, p.to_starboard) : { lengthM: fin(p.length) ? p.length : null, beamM: fin(p.beam) ? p.beam : null }),
        updatedAt: at,
      },
      source: txt(p.source)?.split(":")[0] ?? "openwaters",
    });
  }
  return out;
}

/**
 * Rough shipping density of a 10° cell centre (0–3), used to pick which cells
 * to load when the view is too wide to load them all.
 */
export function shippingWeight(lat: number, lon: number): number {
  const box = (w: number, s: number, e: number, n: number) => lon >= w && lon <= e && lat >= s && lat <= n;
  if (box(-10, 35, 30, 62) || box(95, -10, 125, 40) || box(-15, 30, 40, 46)) return 3; // N Europe, SE/E Asia, Mediterranean
  if (box(120, 20, 145, 45) || box(-100, 15, -60, 50) || box(45, 5, 75, 30) || box(-130, 25, -115, 50)) return 2; // Japan/Korea, US Gulf & East coast, Arabian Sea/Gulf, US West coast
  if (box(-80, -40, -30, 15) || box(110, -45, 160, -10) || box(-25, -40, 55, 35) || box(-180, -60, 180, 75)) return 1;
  return 0;
}

export interface OwCell {
  key: string;
  /** latMin,lonMin,latMax,lonMax (Open Waters order) */
  query: string;
}

/** 10° cells covering a viewport bbox [w, s, e, n] (e < w across the antimeridian), at most `max`. */
export function owCells(bbox: [number, number, number, number], max = 4): { cells: OwCell[]; truncated: boolean } {
  let [w, s, e, n] = bbox;
  s = Math.max(-80, s);
  n = Math.min(80, n);
  if (![w, s, e, n].every(Number.isFinite) || n <= s) return { cells: [], truncated: false };
  if (e < w) e += 360;
  if (e - w >= 360) [w, e] = [-180, 180];
  const D = OW_CELL_DEG, per = 360 / D;
  const cLat = (s + n) / 2, cLon = (w + e) / 2;
  const all: Array<{ i: number; j: number; d: number }> = [];
  for (let i = Math.floor(s / D); i <= Math.floor((n - 1e-9) / D); i++)
    for (let j = Math.floor(w / D); j <= Math.floor((e - 1e-9) / D); j++)
      all.push({ i, j, d: Math.hypot((i + 0.5) * D - cLat, ((j + 0.5) * D - cLon) * Math.cos((cLat * Math.PI) / 180)) });
  const truncated = all.length > max;
  const wrapJ = (j: number) => ((((j + per / 2) % per) + per) % per) - per / 2;
  const weight = (c: { i: number; j: number }) => (truncated ? shippingWeight((c.i + 0.5) * D, (wrapJ(c.j) + 0.5) * D) : 0);
  all.sort((a, b) => weight(b) - weight(a) || a.d - b.d);
  const cells: OwCell[] = [];
  const seen = new Set<string>();
  for (const { i, j } of all) {
    const jj = wrapJ(j);
    const key = `${i}:${jj}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (cells.length >= max) break;
    cells.push({ key, query: `${i * D},${jj * D},${(i + 1) * D},${(jj + 1) * D}` });
  }
  return { cells, truncated };
}
