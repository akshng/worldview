/**
 * Live aircraft around the current map view, from adsb.lol (keyless, ODbL 1.0).
 *
 * The viewport is split into fixed 6° cells; each cell is one adsb.lol
 * point/radius query cached for CELL_TTL_MS and shared by every client, so
 * panning around a busy area costs few upstream requests. adsb.lol rate-limits
 * per IP (nginx; sustained about one request every 3 s, small burst), so every
 * upstream request goes through one throttled queue. The latest full record per
 * aircraft and a short trail are kept in memory for the detail panel.
 */
import { SourceHttpError } from "@/data-sources/types";
import { userAgent } from "@/lib/env";
import { TrailStore } from "../trails";
import { adsbLolRow, AIR_FIELDS, inBbox, viewportCells, type AdsbLolAircraft, type AdsbLolResponse, type AirRow, type QueryCell } from "./parser";
import { airlineFromCallsign, categoryLabel, icaoCountry, squawkMeaning, typeName } from "./reference";

export const ADSBLOL_ATTRIBUTION = "adsb.lol, ODbL 1.0";
const API = "https://api.adsb.lol/v2";
const CELL_TTL_MS = 25_000;
const CELL_ERROR_BACKOFF_MS = 30_000;
const MAX_CELLS = 4;
const MAX_ROWS = 5_000;
/** How long a viewport request waits for cells before answering with what it has */
const VIEWPORT_WAIT_MS = 3_000;
const RECORD_MAX_AGE_MS = 10 * 60_000;
/** Minimum spacing between adsb.lol requests from this server */
const MIN_GAP_MS = 2_600;
const MAX_QUEUE = 8;

interface CellEntry {
  rows: AirRow[];
  fetchedAt: number;
  inflight: Promise<AirRow[]> | null;
  error: string | null;
  errorAt: number;
}

interface AirState {
  cells: Map<string, CellEntry>;
  /** tail of the upstream request queue, when the next request may start, queued count */
  queue: Promise<void>;
  nextAt: number;
  queued: number;
  /** latest full upstream record per hex, with when we saw it */
  records: Map<string, { ac: AdsbLolAircraft; at: number }>;
  trails: TrailStore;
}
const g = globalThis as unknown as { __worldviewAir?: AirState };
const air: AirState = (g.__worldviewAir ??= {
  cells: new Map(),
  queue: Promise.resolve(),
  nextAt: 0,
  queued: 0,
  records: new Map(),
  trails: new TrailStore(20, 20 * 60_000, 60_000, 8_000),
});

/**
 * GET an adsb.lol URL through the shared throttle: requests run one at a time,
 * MIN_GAP_MS apart; a 429 pushes the next slot back 20 s. Fails fast when the
 * queue is long rather than piling up work.
 */
export function adsbLolGet<T>(url: string, timeoutMs = 15_000): Promise<T> {
  if (air.queued >= MAX_QUEUE) return Promise.reject(new Error("adsb.lol request queue full — try again shortly"));
  air.queued++;
  const run = air.queue.then(async () => {
    const wait = air.nextAt - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    air.nextAt = Date.now() + MIN_GAP_MS;
    try {
      // A fresh connection per request: adsb.lol keeps refusing a kept-alive connection after one 429.
      const res = await fetch(url, {
        signal: AbortSignal.timeout(timeoutMs),
        headers: { "User-Agent": userAgent(), Accept: "application/json", Connection: "close" },
        cache: "no-store",
      });
      if (res.status === 429 || res.status === 420) air.nextAt = Date.now() + 20_000;
      if (!res.ok) throw new SourceHttpError(res.status, `adsb.lol HTTP ${res.status}${res.status === 429 || res.status === 420 ? " rate limited" : ""}`);
      return (await res.json()) as T;
    } finally {
      air.queued--;
    }
  });
  air.queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** Remember full records + trail points (also fed by the military layer). */
export function recordAircraft(list: AdsbLolAircraft[] | undefined, now = Date.now()) {
  for (const a of list ?? []) {
    const r = adsbLolRow(a);
    if (!r) continue;
    const at = now - r[11] * 1000;
    air.records.set(r[0], { ac: a, at });
    air.trails.add(`air:${r[0]}`, r[4], r[5], at);
  }
  if (air.records.size > 40_000) {
    for (const [hex, rec] of air.records) if (now - rec.at > RECORD_MAX_AGE_MS) air.records.delete(hex);
    air.trails.prune(now);
  }
}

async function fetchCell(c: QueryCell): Promise<AirRow[]> {
  const raw = await adsbLolGet<AdsbLolResponse>(`${API}/lat/${c.lat}/lon/${c.lon}/dist/${c.radiusNm}`);
  const now = Date.now();
  recordAircraft(raw.ac, now);
  const rows: AirRow[] = [];
  for (const a of raw.ac ?? []) {
    const r = adsbLolRow(a);
    if (r) rows.push(r);
  }
  return rows;
}

function cellRows(c: QueryCell, now: number): Promise<AirRow[]> {
  let e = air.cells.get(c.key);
  if (!e) air.cells.set(c.key, (e = { rows: [], fetchedAt: 0, inflight: null, error: null, errorAt: 0 }));
  const entry = e;
  if (now - entry.fetchedAt < CELL_TTL_MS) return Promise.resolve(entry.rows);
  if (entry.error && now - entry.errorAt < CELL_ERROR_BACKOFF_MS) return entry.fetchedAt ? Promise.resolve(entry.rows) : Promise.reject(new Error(entry.error));
  entry.inflight ??= fetchCell(c)
    .then((rows) => {
      Object.assign(entry, { rows, fetchedAt: Date.now(), error: null });
      return rows;
    })
    .catch((err: unknown) => {
      Object.assign(entry, { error: err instanceof Error ? err.message : String(err), errorAt: Date.now() });
      if (entry.fetchedAt) return entry.rows;
      throw err;
    })
    .finally(() => {
      entry.inflight = null;
    });
  return entry.inflight;
}

export interface ViewportAircraft {
  observedAt: string;
  count: number;
  data: { fields: string[]; rows: AirRow[] };
  /** Bboxes of the cells that were loaded (for drawing coverage) */
  cells: Array<[number, number, number, number]>;
  /** The view needed more cells than allowed: only the centre was loaded */
  truncated: boolean;
  /** Rows dropped by the marker cap */
  capped: boolean;
  /** Cells still loading (poll again shortly) */
  pending: number;
  errors: string[];
  attribution: string;
}

/** Aircraft inside a viewport bbox [w, s, e, n], merged across cells and de-duplicated. */
export async function viewportAircraft(bbox: [number, number, number, number]): Promise<ViewportAircraft> {
  const now = Date.now();
  const { cells, truncated } = viewportCells(bbox, MAX_CELLS);
  const results: AirRow[][] = [];
  const errors: string[] = [];
  // Cells are queued nearest-first; answer with whatever is ready after VIEWPORT_WAIT_MS
  // (stale rows for cells still refreshing) and let the client poll again for the rest.
  const settled = cells.map((c) => {
    const st: { done: boolean; rows?: AirRow[]; error?: string } = { done: false };
    const p = cellRows(c, now).then(
      (rows) => Object.assign(st, { done: true, rows }),
      (e: unknown) => Object.assign(st, { done: true, error: e instanceof Error ? e.message : String(e) }),
    );
    return { c, st, p };
  });
  await Promise.race([Promise.all(settled.map((x) => x.p)), new Promise((r) => setTimeout(r, VIEWPORT_WAIT_MS))]);
  let pending = 0;
  for (const { c, st } of settled) {
    if (st.rows) results.push(st.rows);
    else if (st.error) errors.push(st.error);
    else {
      pending++;
      const stale = air.cells.get(c.key);
      if (stale?.fetchedAt) results.push(stale.rows);
    }
  }
  if (!results.length && errors.length && !pending) throw new Error(errors[0]);
  const byHex = new Map<string, AirRow>();
  for (const rows of results) for (const r of rows) if (inBbox(r[4], r[5], bbox) && (!byHex.has(r[0]) || byHex.get(r[0])![11] > r[11])) byHex.set(r[0], r);
  let rows = [...byHex.values()];
  const capped = rows.length > MAX_ROWS;
  if (capped) {
    // Keep airborne aircraft nearest the view centre.
    const [w, s, e, n] = bbox;
    const cy = (s + n) / 2, cx = e >= w ? (w + e) / 2 : ((w + e + 360) / 2 + 540) % 360 - 180;
    rows = rows.sort((a, b) => Number(a[7]) - Number(b[7]) || Math.hypot(a[4] - cx, a[5] - cy) - Math.hypot(b[4] - cx, b[5] - cy)).slice(0, MAX_ROWS);
  }
  return {
    observedAt: new Date(now).toISOString(),
    count: rows.length,
    data: { fields: AIR_FIELDS, rows },
    cells: cells.map((c) => c.bbox),
    truncated,
    capped,
    pending,
    errors: [...new Set(errors)].slice(0, 3),
    attribution: ADSBLOL_ATTRIBUTION,
  };
}

export interface AircraftDetail {
  hex: string;
  callsign: string | null;
  registration: string | null;
  typeCode: string | null;
  typeName: string | null;
  category: string | null;
  categoryLabel: string | null;
  operator: string | null;
  operatorSource: "database" | "callsign" | null;
  country: { code: string; name: string } | null;
  military: boolean;
  altBaroFt: number | null;
  altGeomFt: number | null;
  onGround: boolean;
  gsKt: number | null;
  tasKt: number | null;
  mach: number | null;
  trackDeg: number | null;
  headingDeg: number | null;
  vertRateFpm: number | null;
  selectedAltFt: number | null;
  squawk: string | null;
  squawkMeaning: string | null;
  emergency: string | null;
  lat: number | null;
  lon: number | null;
  /** ms epoch of the last position */
  observedAt: number | null;
  positionSource: string | null;
  trail: Array<[number, number, number]>;
  links: Array<{ label: string; url: string }>;
  attribution: string;
}

const fin = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const s = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

/** Detail record → panel fields. Pure (exported for tests). */
export function aircraftDetailFrom(hex: string, ac: AdsbLolAircraft | null, at: number | null, trail: Array<[number, number, number]> = []): AircraftDetail {
  const a = ac ?? {};
  const callsign = s(a.flight);
  const dbOp = s(a.ownOp);
  const csOp = airlineFromCallsign(callsign);
  const onGround = a.alt_baro === "ground";
  const pos = a.type ?? null;
  return {
    hex,
    callsign,
    registration: s(a.r),
    typeCode: s(a.t),
    typeName: s(a.desc) ?? typeName(a.t),
    category: s(a.category),
    categoryLabel: categoryLabel(a.category),
    operator: dbOp ?? csOp,
    operatorSource: dbOp ? "database" : csOp ? "callsign" : null,
    country: icaoCountry(hex),
    military: fin(a.dbFlags) && (a.dbFlags & 1) === 1,
    altBaroFt: onGround ? 0 : fin(a.alt_baro) ? a.alt_baro : null,
    altGeomFt: fin(a.alt_geom) ? a.alt_geom : null,
    onGround,
    gsKt: fin(a.gs) ? Math.round(a.gs) : null,
    tasKt: fin(a.tas) ? Math.round(a.tas) : null,
    mach: fin(a.mach) ? a.mach : null,
    trackDeg: fin(a.track) ? Math.round(a.track) : null,
    headingDeg: fin(a.true_heading) ? Math.round(a.true_heading) : fin(a.mag_heading) ? Math.round(a.mag_heading) : null,
    vertRateFpm: fin(a.baro_rate) ? a.baro_rate : fin(a.geom_rate) ? a.geom_rate : null,
    selectedAltFt: fin(a.nav_altitude_mcp) ? a.nav_altitude_mcp : fin(a.nav_altitude_fms) ? a.nav_altitude_fms : null,
    squawk: s(a.squawk),
    squawkMeaning: squawkMeaning(s(a.squawk)),
    emergency: a.emergency && a.emergency !== "none" ? a.emergency : null,
    lat: fin(a.lat) ? a.lat : null,
    lon: fin(a.lon) ? a.lon : null,
    observedAt: at,
    positionSource: pos === "mlat" ? "MLAT (multilateration)" : pos?.startsWith("adsb") ? "ADS-B" : pos?.startsWith("tisb") ? "TIS-B" : pos?.startsWith("adsr") ? "ADS-R" : pos,
    trail,
    links: [
      { label: "adsb.lol track", url: `https://globe.adsb.lol/?icao=${hex}` },
      { label: "OpenSky", url: `https://opensky-network.org/aircraft-profile?icao24=${hex}` },
    ],
    attribution: ADSBLOL_ATTRIBUTION,
  };
}

/** Latest known detail for an aircraft; refreshes from adsb.lol /v2/hex when we have none newer than 60 s. */
export async function aircraftDetail(hex: string): Promise<AircraftDetail | null> {
  const now = Date.now();
  let rec = air.records.get(hex);
  if (!rec || now - rec.at > 60_000) {
    try {
      const raw = await adsbLolGet<AdsbLolResponse>(`${API}/hex/${hex}`, 10_000);
      const hit = (raw.ac ?? []).find((a) => (a.hex ?? "").toLowerCase() === hex);
      if (hit) {
        recordAircraft([hit], now);
        // keep the richer record if the hex endpoint returns no position
        rec = air.records.get(hex) ?? { ac: hit, at: now };
      }
    } catch {
      /* fall back to what we have */
    }
  }
  if (!rec) return null;
  return aircraftDetailFrom(hex, rec.ac, rec.at, air.trails.get(`air:${hex}`, now));
}
