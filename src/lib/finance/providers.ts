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

export async function yahooQuote(symbol: string, name: string | null, group: InstrumentGroup): Promise<Quote> {
  const d = await getJson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=1h&includePrePost=false`);
  const r = d?.chart?.result?.[0];
  if (!r) throw new Error(d?.chart?.error?.description ?? "No data");
  const m = r.meta ?? {};
  const closes: number[] = (r.indicators?.quote?.[0]?.close ?? []).filter((x: unknown): x is number => typeof x === "number");
  const price = typeof m.regularMarketPrice === "number" ? m.regularMarketPrice : (closes[closes.length - 1] ?? null);
  const prev = typeof m.previousClose === "number" ? m.previousClose : typeof m.chartPreviousClose === "number" ? m.chartPreviousClose : null;
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
