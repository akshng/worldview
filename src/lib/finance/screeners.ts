/**
 * US stock movers from Yahoo Finance's predefined screeners (unofficial, delayed):
 * day gainers / day losers / most active. Cached 5 minutes per list.
 */
import "server-only";
import { userAgent } from "@/lib/env";

export const SCREENERS = { gainers: "day_gainers", losers: "day_losers", active: "most_actives" } as const;
export type ScreenerList = keyof typeof SCREENERS;

export interface ScreenerRow {
  symbol: string;
  name: string;
  price: number | null;
  changePct: number | null;
  volume: number | null;
  marketCap: number | null;
  exchange: string | null;
}

export interface ScreenerResult {
  list: ScreenerList;
  rows: ScreenerRow[];
  asOf: string;
  source: string;
}

type RawQuote = {
  symbol?: string;
  shortName?: string;
  longName?: string;
  regularMarketPrice?: number;
  regularMarketChangePercent?: number;
  regularMarketVolume?: number;
  marketCap?: number;
  fullExchangeName?: string;
  exchange?: string;
  quoteType?: string;
};

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

export function parseScreener(j: unknown, list: ScreenerList, limit = 15): ScreenerRow[] {
  const quotes = ((j as { finance?: { result?: Array<{ quotes?: RawQuote[] }> } })?.finance?.result?.[0]?.quotes ?? []) as RawQuote[];
  return quotes
    .filter((q) => typeof q.symbol === "string" && /^[A-Za-z0-9.\-]{1,12}$/.test(q.symbol) && (q.quoteType ?? "EQUITY") === "EQUITY")
    .map((q) => ({
      symbol: q.symbol!,
      name: q.shortName ?? q.longName ?? q.symbol!,
      price: num(q.regularMarketPrice),
      changePct: num(q.regularMarketChangePercent),
      volume: num(q.regularMarketVolume),
      marketCap: num(q.marketCap),
      exchange: q.fullExchangeName ?? q.exchange ?? null,
    }))
    .sort((a, b) => (list === "active" ? (b.volume ?? 0) - (a.volume ?? 0) : list === "gainers" ? (b.changePct ?? 0) - (a.changePct ?? 0) : (a.changePct ?? 0) - (b.changePct ?? 0)))
    .slice(0, limit);
}

const TTL = 5 * 60_000;
const g = globalThis as unknown as { __worldviewScreeners?: Map<ScreenerList, { at: number; value: ScreenerResult }> };
const cache = (g.__worldviewScreeners ??= new Map());

export async function getScreener(list: ScreenerList): Promise<ScreenerResult> {
  const hit = cache.get(list);
  if (hit && Date.now() - hit.at < TTL) return hit.value;
  const res = await fetch(`https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?scrIds=${SCREENERS[list]}&count=25`, {
    headers: { "User-Agent": userAgent(), Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  if (!res.ok) {
    if (hit) return hit.value;
    throw new Error(`HTTP ${res.status}`);
  }
  const value: ScreenerResult = { list, rows: parseScreener(await res.json(), list), asOf: new Date().toISOString(), source: "Yahoo Finance screeners (unofficial, delayed)" };
  cache.set(list, { at: Date.now(), value });
  return value;
}
