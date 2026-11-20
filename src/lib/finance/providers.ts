/**
 * Keyless market data providers.
 *  - Yahoo Finance chart endpoint (indices, stocks, futures, FX). Unofficial, delayed;
 *    personal/non-commercial use. Quotes are labelled as delayed in the UI.
 *  - Coinbase Exchange public candles (crypto).
 *  - U.S. Treasury daily par yield curve CSV (rates).
 */
import "server-only";
import { userAgent } from "@/lib/env";
import type { Quote, InstrumentGroup } from "./types";

const TIMEOUT = 15_000;

async function getJson(url: string) {
  const res = await fetch(url, { headers: { "User-Agent": userAgent(), Accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT), cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}${res.status === 429 ? " rate limited" : ""}`);
  return res.json();
}

/**
 * Previous session's close from a Yahoo chart response. `meta.previousClose` is only sent for
 * some ranges; `meta.chartPreviousClose` is the close before the chart's FIRST bar, which is only
 * yesterday's close on the 1d range (on 1mo it is a month old). Otherwise take the last bar from
 * an earlier exchange-local day; weekly/monthly bars can't give a daily close, so null.
 */
export function previousCloseOf(meta: Record<string, unknown>, timestamps: number[], closes: Array<number | null | undefined>): number | null {
  const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : null);
  const prev = num(meta.previousClose);
  if (prev !== null) return prev;
  if (meta.range === "1d") return num(meta.chartPreviousClose);
  if (typeof meta.dataGranularity === "string" && !/^(\d+[mh]|1d)$/.test(meta.dataGranularity)) return null;
  const off = num(meta.gmtoffset) ?? 0;
  const day = (t: number) => new Date((t + off) * 1000).toISOString().slice(0, 10);
  const lastT = num(meta.regularMarketTime) ?? timestamps.at(-1);
  if (lastT === undefined) return null;
  const today = day(lastT);
  for (let i = timestamps.length - 1; i >= 0; i--) {
    const c = num(closes[i]);
    if (c !== null && day(timestamps[i]) < today) return c;
  }
  return null;
}

export async function yahooQuote(symbol: string, name: string | null, group: InstrumentGroup): Promise<Quote> {
  const d = await getJson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=1h&includePrePost=false`);
  const r = d?.chart?.result?.[0];
  if (!r) throw new Error(d?.chart?.error?.description ?? "No data");
  const m = r.meta ?? {};
  const rawCloses: Array<number | null> = r.indicators?.quote?.[0]?.close ?? [];
  const closes: number[] = rawCloses.filter((x: unknown): x is number => typeof x === "number");
  const price = typeof m.regularMarketPrice === "number" ? m.regularMarketPrice : (closes[closes.length - 1] ?? null);
  const prev = previousCloseOf(m, r.timestamp ?? [], rawCloses);
  const change = price !== null && prev ? price - prev : null;
  return {
    symbol,
    name: name ?? m.shortName ?? m.longName ?? symbol,
    group,
    price,
    change,
    changePct: change !== null && prev ? (change / prev) * 100 : null,
    unit: "price",
    currency: m.currency ?? null,
    asOf: m.regularMarketTime ? new Date(m.regularMarketTime * 1000).toISOString() : null,
    spark: closes.slice(-40),
    source: "Yahoo Finance (unofficial, delayed)",
    delayed: true,
  };
}

export async function coinbaseQuote(symbol: string, name: string): Promise<Quote> {
  // [time, low, high, open, close, volume], newest first; hourly.
  const candles = (await getJson(`https://api.exchange.coinbase.com/products/${encodeURIComponent(symbol)}/candles?granularity=3600`)) as number[][];
  if (!Array.isArray(candles) || !candles.length) throw new Error("No data");
  const chron = [...candles].reverse();
  const price = chron[chron.length - 1][4];
  const dayAgo = chron[Math.max(0, chron.length - 25)][4];
  return {
    symbol,
    name,
    group: "crypto",
    price,
    change: price - dayAgo,
    changePct: ((price - dayAgo) / dayAgo) * 100,
    unit: "price",
    currency: "USD",
    asOf: new Date(chron[chron.length - 1][0] * 1000 + 3_600_000).toISOString(),
    spark: chron.slice(-48).map((c) => c[4]),
    source: "Coinbase Exchange (24 h change)",
    delayed: false,
  };
}

/** Daily par yield curve; returns quotes for 2Y/10Y/30Y and the 2s10s spread. */
export async function treasuryQuotes(now = new Date()): Promise<Quote[]> {
  const year = now.getUTCFullYear();
  const url = (y: number) =>
    `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/${y}/all?type=daily_treasury_yield_curve&field_tdr_date_value=${y}&page&_format=csv`;
  const fetchCsv = async (y: number) => {
    const res = await fetch(url(y), { headers: { "User-Agent": userAgent() }, signal: AbortSignal.timeout(45_000), cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
  };
  let csv = await fetchCsv(year);
  let rows = parseTreasuryCsv(csv);
  if (rows.length < 12) {
    csv = await fetchCsv(year - 1);
    rows = [...rows, ...parseTreasuryCsv(csv)];
  }
  rows.sort((a, b) => a.date.localeCompare(b.date));
  const recent = rows.slice(-20);
  const last = recent[recent.length - 1], prev = recent[recent.length - 2];
  const mk = (symbol: string, name: string, pick: (r: TreasuryRow) => number | null): Quote => {
    const p = last ? pick(last) : null, q = prev ? pick(prev) : null;
    return {
      symbol,
      name,
      group: "rates",
      price: p,
      change: p !== null && q !== null ? p - q : null,
      changePct: null,
      unit: "percent",
      currency: null,
      asOf: last ? new Date(`${last.date}T21:00:00Z`).toISOString() : null,
      spark: recent.map(pick).filter((x): x is number => x !== null),
      source: "U.S. Treasury daily par yield curve",
      delayed: true,
    };
  };
  return [
    mk("DGS2", "US 2-year", (r) => r.y2),
    mk("DGS10", "US 10-year", (r) => r.y10),
    mk("DGS30", "US 30-year", (r) => r.y30),
    mk("SPREAD2S10S", "2s10s spread", (r) => (r.y10 !== null && r.y2 !== null ? Math.round((r.y10 - r.y2) * 100) / 100 : null)),
  ];
}

export interface TreasuryRow {
  date: string;
  y2: number | null;
  y10: number | null;
  y30: number | null;
}

export function parseTreasuryCsv(csv: string): TreasuryRow[] {
  const lines = csv.trim().split(/\r?\n/);
  const head = lines[0].split(",").map((h) => h.replace(/"/g, "").trim());
  const ix = (n: string) => head.indexOf(n);
  const num = (s: string | undefined) => (s && s.trim() !== "" && !Number.isNaN(Number(s)) ? Number(s) : null);
  return lines.slice(1).map((l) => {
    const c = l.split(",");
    const [mm, dd, yyyy] = (c[ix("Date")] ?? "").split("/");
    return { date: `${yyyy}-${mm}-${dd}`, y2: num(c[ix("2 Yr")]), y10: num(c[ix("10 Yr")]), y30: num(c[ix("30 Yr")]) };
  }).filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.date));
}

export const HISTORY_RANGES = {
  "1d": { range: "1d", interval: "5m" },
  "5d": { range: "5d", interval: "30m" },
  "1mo": { range: "1mo", interval: "1d" },
  "6mo": { range: "6mo", interval: "1d" },
  "1y": { range: "1y", interval: "1d" },
  "2y": { range: "2y", interval: "1d" },
  "5y": { range: "5y", interval: "1wk" },
} as const;
export type HistoryRange = keyof typeof HISTORY_RANGES;

export interface PriceHistory {
  symbol: string;
  name: string;
  currency: string | null;
  exchange: string | null;
  instrumentType: string | null;
  points: Array<[number, number]>; // [unix ms, close]
  previousClose: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
  volume: number | null;
  marketTime: string | null;
}

export async function yahooHistory(symbol: string, range: HistoryRange): Promise<PriceHistory> {
  const { range: r, interval } = HISTORY_RANGES[range];
  const d = await getJson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${r}&interval=${interval}&includePrePost=false`);
  const res = d?.chart?.result?.[0];
  if (!res) throw new Error(d?.chart?.error?.description ?? "No data");
  const m = res.meta ?? {};
  const ts: number[] = res.timestamp ?? [];
  const cl: Array<number | null> = res.indicators?.quote?.[0]?.close ?? [];
  const points: Array<[number, number]> = [];
  ts.forEach((t, i) => {
    const v = cl[i];
    if (typeof v === "number") points.push([t * 1000, v]);
  });
  const n = (x: unknown) => (typeof x === "number" ? x : null);
  return {
    symbol,
    name: m.longName ?? m.shortName ?? symbol,
    currency: m.currency ?? null,
    exchange: m.fullExchangeName ?? m.exchangeName ?? null,
    instrumentType: m.instrumentType ?? null,
    points,
    previousClose: previousCloseOf(m, ts, cl),
    dayHigh: n(m.regularMarketDayHigh),
    dayLow: n(m.regularMarketDayLow),
    fiftyTwoWeekHigh: n(m.fiftyTwoWeekHigh),
    fiftyTwoWeekLow: n(m.fiftyTwoWeekLow),
    volume: n(m.regularMarketVolume),
    marketTime: m.regularMarketTime ? new Date(m.regularMarketTime * 1000).toISOString() : null,
  };
}

export const CURVE_TENORS = ["1 Mo", "2 Mo", "3 Mo", "6 Mo", "1 Yr", "2 Yr", "3 Yr", "5 Yr", "7 Yr", "10 Yr", "20 Yr", "30 Yr"] as const;

export interface YieldCurve {
  latest: { date: string; yields: Array<{ tenor: string; value: number | null }> };
  monthAgo: { date: string; yields: Array<{ tenor: string; value: number | null }> } | null;
}

export function parseCurveCsv(csv: string): Array<{ date: string; yields: Record<string, number | null> }> {
  const lines = csv.trim().split(/\r?\n/);
  const head = lines[0].split(",").map((h) => h.replace(/"/g, "").trim());
  return lines.slice(1).map((l) => {
    const c = l.split(",");
    const [mm, dd, yyyy] = (c[0] ?? "").split("/");
    const yields: Record<string, number | null> = {};
    for (const t of CURVE_TENORS) {
      const v = c[head.indexOf(t)];
      yields[t] = v && v.trim() !== "" && !Number.isNaN(Number(v)) ? Number(v) : null;
    }
    return { date: `${yyyy}-${mm}-${dd}`, yields };
  }).filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.date)).sort((a, b) => a.date.localeCompare(b.date));
}

export async function treasuryCurve(now = new Date()): Promise<YieldCurve> {
  const y = now.getUTCFullYear();
  const url = (yr: number) =>
    `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/${yr}/all?type=daily_treasury_yield_curve&field_tdr_date_value=${yr}&page&_format=csv`;
  const get = async (yr: number) => {
    const r = await fetch(url(yr), { headers: { "User-Agent": userAgent() }, signal: AbortSignal.timeout(45_000), cache: "no-store" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return parseCurveCsv(await r.text());
  };
  let rows = await get(y);
  if (rows.length < 25) rows = [...(await get(y - 1)), ...rows];
  const latest = rows[rows.length - 1];
  const target = new Date(Date.parse(latest.date) - 30 * 86_400_000).toISOString().slice(0, 10);
  const monthAgo = [...rows].reverse().find((r) => r.date <= target) ?? null;
  const fmt = (r: (typeof rows)[number]) => ({ date: r.date, yields: CURVE_TENORS.map((t) => ({ tenor: t, value: r.yields[t] })) });
  return { latest: fmt(latest), monthAgo: monthAgo ? fmt(monthAgo) : null };
}
