/**
 * Ships around the current map view (GET /api/ships): the global maritime
 * layer (Fintraffic + Kystverket, plus AISStream.io with a key) merged with
 * Open Waters AIS cells covering the view, so ships show worldwide without a
 * key. Open Waters cells are fetched one at a time (anonymous tier: 2
 * connections per IP), cached for OW_TTL_MS and shared between clients.
 */
import { userAgent } from "@/lib/env";
import { getLayer } from "../registry";
import { inBbox } from "../aircraft/parser";
import { ingestVessels } from ".";
import { OPENWATERS_ATTRIBUTION, owCells, parseOpenWaters, type OpenWatersResponse, type OwCell } from "./openwaters";
import type { MaritimeData, VesselRow } from "./types";

const OW_URL = "https://ais.openwaters.io/v1/vessels";
const OW_TTL_MS = 60_000;
const OW_ERROR_BACKOFF_MS = 60_000;
const OW_GAP_MS = 1_000;
const MAX_CELLS = 8;
const WAIT_MS = 3_500;
const MAX_ROWS = 12_000;

interface Cell {
  rows: VesselRow[];
  fetchedAt: number;
  inflight: Promise<VesselRow[]> | null;
  error: string | null;
  errorAt: number;
}
interface OwState {
  cells: Map<string, Cell>;
  queue: Promise<void>;
  nextAt: number;
}
const g = globalThis as unknown as { __worldviewOw?: OwState };
const ow: OwState = (g.__worldviewOw ??= { cells: new Map(), queue: Promise.resolve(), nextAt: 0 });

function fetchCell(c: OwCell): Promise<VesselRow[]> {
  const run = ow.queue.then(async () => {
    const wait = ow.nextAt - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    ow.nextAt = Date.now() + OW_GAP_MS;
    const res = await fetch(`${OW_URL}?bbox=${c.query}`, {
      signal: AbortSignal.timeout(20_000),
      headers: { "User-Agent": userAgent(), Accept: "application/json" },
      cache: "no-store",
    });
    if (res.status === 429) ow.nextAt = Date.now() + 30_000;
    if (!res.ok) throw new Error(`Open Waters AIS HTTP ${res.status}`);
    const items = parseOpenWaters((await res.json()) as OpenWatersResponse);
    ingestVessels(items);
    return items.map((i) => i.row);
  });
  ow.queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function cellRows(c: OwCell, now: number): Promise<VesselRow[]> {
  let e = ow.cells.get(c.key);
  if (!e) ow.cells.set(c.key, (e = { rows: [], fetchedAt: 0, inflight: null, error: null, errorAt: 0 }));
  const entry = e;
  if (now - entry.fetchedAt < OW_TTL_MS) return Promise.resolve(entry.rows);
  if (entry.error && now - entry.errorAt < OW_ERROR_BACKOFF_MS) return entry.fetchedAt ? Promise.resolve(entry.rows) : Promise.reject(new Error(entry.error));
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

export interface ViewportShips {
  observedAt: string;
  count: number;
  data: MaritimeData;
  /** The view needed more Open Waters cells than allowed: the busiest areas were loaded */
  truncated: boolean;
  /** Cells still loading (poll again shortly) */
  pending: number;
  /** AISSTREAM_API_KEY is configured */
  keyed: boolean;
  errors: string[];
  attribution: string;
}

export async function viewportShips(bbox: [number, number, number, number]): Promise<ViewportShips> {
  const now = Date.now();
  const { cells, truncated } = owCells(bbox, MAX_CELLS);
  const errors: string[] = [];
  const results: VesselRow[][] = [];
  const settled = cells.map((c) => {
    const st: { rows?: VesselRow[]; error?: string } = {};
    const p = cellRows(c, now).then(
      (rows) => (st.rows = rows),
      (e: unknown) => (st.error = e instanceof Error ? e.message : String(e)),
    );
    return { c, st, p };
  });
  // The global layer (Baltic / Norway / AISStream) in parallel with the cells.
  const layer = getLayer("maritime").catch((e: unknown) => {
    errors.push(e instanceof Error ? e.message : String(e));
    return null;
  });
  await Promise.race([Promise.all(settled.map((x) => x.p)), new Promise((r) => setTimeout(r, WAIT_MS))]);
  let pending = 0;
  for (const { c, st } of settled) {
    if (st.rows) results.push(st.rows);
    else if (st.error) errors.push(st.error);
    else {
      pending++;
      const stale = ow.cells.get(c.key);
      if (stale?.fetchedAt) results.push(stale.rows);
    }
  }
  const snap = await layer;
  const base = snap?.snapshot.data as MaritimeData | undefined;
  const byMmsi = new Map<number, VesselRow>();
  const add = (r: VesselRow) => {
    if (!inBbox(r[2], r[3], bbox)) return;
    const prev = byMmsi.get(r[0]);
    if (!prev || prev[8] < r[8]) byMmsi.set(r[0], prev ? mergeRow(r, prev) : r);
  };
  for (const r of base?.rows ?? []) add(r);
  for (const rows of results) for (const r of rows) add(r);
  let rows = [...byMmsi.values()];
  if (rows.length > MAX_ROWS) {
    const [w, s, e, n] = bbox;
    const cy = (s + n) / 2, cx = e >= w ? (w + e) / 2 : ((w + e + 360) / 2 + 540) % 360 - 180;
    rows = rows.sort((a, b) => Math.hypot(a[2] - cx, a[3] - cy) - Math.hypot(b[2] - cx, b[3] - cy)).slice(0, MAX_ROWS);
  }
  const keyed = !!process.env.AISSTREAM_API_KEY;
  return {
    observedAt: new Date(now).toISOString(),
    count: rows.length,
    data: {
      fields: base?.fields ?? [],
      rows,
      source: "viewport",
      feeds: [...(base?.feeds ?? []), { id: "openwaters", name: "Open Waters AIS", area: "around the map view (worldwide)", count: results.reduce((a, r) => a + r.length, 0), error: errors[0] ?? null }],
    },
    truncated,
    pending,
    keyed,
    errors: [...new Set(errors)].slice(0, 3),
    attribution: `${snap?.snapshot.attribution ?? ""}${snap ? " · " : ""}${OPENWATERS_ATTRIBUTION}`,
  };
}

/** Newer position, but keep name / type / destination the newer row lacks. */
function mergeRow(newer: VesselRow, older: VesselRow): VesselRow {
  const r = [...newer] as VesselRow;
  r[1] = r[1] || older[1];
  r[9] = r[9] ?? older[9];
  r[10] = r[10] ?? older[10];
  return r;
}
