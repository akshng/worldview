/**
 * Futures term structure: prices of consecutive contract months from the Yahoo
 * Finance chart endpoint (unofficial, delayed), e.g. CLZ26.NYM = WTI December 2026.
 * Expired or unlisted months return 404 and are skipped. The VIX curve uses Cboe's
 * constant-maturity volatility indices (9-day … 1-year), since Yahoo doesn't serve
 * VIX futures. Cached 30 minutes.
 */
import "server-only";
import { userAgent } from "@/lib/env";

export const MONTH_CODES = "FGHJKMNQUVXZ";
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

interface CurveDef {
  id: string;
  name: string;
  unit: string;
  /** Yahoo root + exchange suffix, or a fixed list of index symbols */
  root?: string;
  exchange?: string;
  /** Listed month codes (default: every month) */
  months?: string;
  /** Skip the current calendar month (e.g. gold's thin delivery month) */
  skipCurrent?: boolean;
  count?: number;
  indices?: Array<{ symbol: string; label: string }>;
}

export const CURVES: CurveDef[] = [
  { id: "CL", name: "WTI crude oil", unit: "$/bbl", root: "CL", exchange: "NYM", count: 12 },
  { id: "BZ", name: "Brent crude oil", unit: "$/bbl", root: "BZ", exchange: "NYM", count: 12 },
  { id: "NG", name: "Natural gas (Henry Hub)", unit: "$/MMBtu", root: "NG", exchange: "NYM", count: 12 },
  { id: "GC", name: "Gold", unit: "$/oz", root: "GC", exchange: "CMX", months: "GJMQVZ", skipCurrent: true, count: 6 },
  {
    id: "VIX",
    name: "VIX (S&P 500 implied volatility)",
    unit: "index",
    indices: [
      { symbol: "^VIX9D", label: "9 days" },
      { symbol: "^VIX", label: "30 days" },
      { symbol: "^VIX3M", label: "3 months" },
      { symbol: "^VIX6M", label: "6 months" },
      { symbol: "^VIX1Y", label: "1 year" },
    ],
  },
];

export interface Leg {
  symbol: string;
  /** "Dec 26" for contracts, "3 months" for VIX tenors */
  label: string;
  /** Chart position: months ahead for contracts (so unlisted months leave a gap), tenor index for VIX */
  x: number;
}

export interface CurvePoint extends Leg {
  price: number;
  asOf: string | null;
}

export type CurveShape = "contango" | "backwardation" | "flat";

export interface TermCurve {
  id: string;
  name: string;
  unit: string;
  kind: "futures" | "indices";
  points: CurvePoint[];
  /** Last point vs first, % */
  slopePct: number | null;
  shape: CurveShape | null;
}

export interface TermStructure {
  curves: TermCurve[];
  generatedAt: string;
  failed: string[];
  source: string;
}

/** Contract symbols for the next `count` listed months starting at `from` (UTC month), plus one spare for an expired front. */
export function contractSymbols(def: Pick<CurveDef, "root" | "exchange" | "months" | "skipCurrent" | "count">, from: Date): Leg[] {
  const listed = def.months ?? MONTH_CODES;
  const out: Leg[] = [];
  const start = from.getUTCFullYear() * 12 + from.getUTCMonth();
  let y = from.getUTCFullYear(), m = from.getUTCMonth();
  if (def.skipCurrent) m++;
  for (let guard = 0; out.length < (def.count ?? 12) + 1 && guard < 48; guard++, m++) {
    if (m > 11) {
      m = 0;
      y++;
    }
    const code = MONTH_CODES[m];
    if (!listed.includes(code)) continue;
    const yy = String(y % 100).padStart(2, "0");
    out.push({ symbol: `${def.root}${code}${yy}.${def.exchange}`, label: `${MONTH_NAMES[m]} ${yy}`, x: y * 12 + m - start });
  }
  return out;
}

/** Price and time from a Yahoo chart response; null when unusable. */
export function parseChartPrice(j: unknown): { price: number; time: number | null } | null {
  const meta = (j as { chart?: { result?: Array<{ meta?: { regularMarketPrice?: unknown; regularMarketTime?: unknown } }> } })?.chart?.result?.[0]?.meta;
  const price = meta?.regularMarketPrice;
  if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) return null;
  return { price, time: typeof meta?.regularMarketTime === "number" ? meta.regularMarketTime * 1000 : null };
}

/** Slope from the first to the last point; within ±1% counts as flat. */
export function curveShape(points: Array<{ price: number }>): { slopePct: number | null; shape: CurveShape | null } {
  if (points.length < 2) return { slopePct: null, shape: null };
  const a = points[0].price, b = points[points.length - 1].price;
  const slopePct = Math.round(((b - a) / a) * 1000) / 10;
  return { slopePct, shape: slopePct > 1 ? "contango" : slopePct < -1 ? "backwardation" : "flat" };
}

/**
 * Keep the first `count` points and drop stale quotes (a contract that stopped
 * trading days before the others is expired or delisted).
 */
export function assembleCurve(raw: Array<Leg & { price: number; time: number | null }>, count: number): CurvePoint[] {
  const newest = Math.max(0, ...raw.map((r) => r.time ?? 0));
  return raw
    .filter((r) => !newest || !r.time || newest - r.time < 5 * 86_400_000)
    .slice(0, count)
    .map((r) => ({ symbol: r.symbol, label: r.label, x: r.x, price: Math.round(r.price * 1000) / 1000, asOf: r.time ? new Date(r.time).toISOString() : null }));
}

async function chartPrice(symbol: string) {
  const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=1d`, {
    headers: { "User-Agent": userAgent(), Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  if (res.status === 404) return null; // expired / not listed
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return parseChartPrice(await res.json());
}

/** Run tasks a few at a time — Yahoo rate-limits bursts. */
async function pool<T>(tasks: Array<() => Promise<T>>, size = 6): Promise<T[]> {
  const out: T[] = new Array(tasks.length);
  let i = 0;
  await Promise.all(Array.from({ length: size }, async () => {
    while (i < tasks.length) {
      const k = i++;
      out[k] = await tasks[k]();
    }
  }));
  return out;
}

async function load(now = new Date()): Promise<TermStructure> {
  const failed: string[] = [];
  const curves: TermCurve[] = [];
  for (const def of CURVES) {
    const legs: Leg[] = def.indices ? def.indices.map((l, i) => ({ ...l, x: i })) : contractSymbols(def, now);
    let errors = 0;
    const raw = await pool(
      legs.map((l) => async () => {
        try {
          const p = await chartPrice(l.symbol);
          return p ? { ...l, price: p.price, time: p.time } : null;
        } catch {
          errors++;
          return null;
        }
      }),
    );
    const points = assembleCurve(raw.filter((r): r is NonNullable<typeof r> => r !== null), def.indices ? def.indices.length : (def.count ?? 12));
    // A curve with holes from errors (not 404s) would mislead; require most legs.
    if (points.length < 3 || errors > 2) {
      failed.push(def.id);
      continue;
    }
    curves.push({ id: def.id, name: def.name, unit: def.unit, kind: def.indices ? "indices" : "futures", points, ...curveShape(points) });
  }
  return { curves, failed, generatedAt: now.toISOString(), source: "Yahoo Finance chart endpoint (unofficial, delayed); VIX curve from Cboe volatility indices" };
}

const g = globalThis as unknown as { __worldviewTerm?: { at: number; value: TermStructure; pending: Promise<TermStructure> | null } };

export async function getTermStructure(): Promise<TermStructure> {
  const c = g.__worldviewTerm;
  if (c && Date.now() - c.at < 30 * 60_000) return c.value;
  if (c?.pending) return c.pending;
  const pending = load().then((value) => {
    const prev = g.__worldviewTerm?.value;
    // Keep the last good copy of any curve that failed this time.
    if (prev) for (const old of prev.curves) if (!value.curves.some((x) => x.id === old.id)) value.curves.push(old);
    value.curves.sort((a, b) => CURVES.findIndex((d) => d.id === a.id) - CURVES.findIndex((d) => d.id === b.id));
    if (value.curves.length) g.__worldviewTerm = { at: Date.now(), value, pending: null };
    return value;
  });
  g.__worldviewTerm = { at: c?.at ?? 0, value: c?.value ?? { curves: [], failed: [], generatedAt: new Date().toISOString(), source: "" }, pending };
  try {
    return await pending;
  } finally {
    if (g.__worldviewTerm) g.__worldviewTerm.pending = null;
  }
}
