/** Cached market snapshot + on-demand quotes. Each upstream is cached so polling never hammers it. */
import "server-only";
import { globalLru } from "@/lib/server/lru";
import { INSTRUMENTS, SYMBOL_PATTERN } from "./instruments";
import { coinbaseQuote, treasuryCurve, treasuryQuotes, yahooHistory, yahooQuote, type HistoryRange, type PriceHistory, type YieldCurve } from "./providers";
import type { MarketSnapshot, Quote } from "./types";

const QUOTE_TTL = 3 * 60_000;
const TREASURY_TTL = 6 * 3_600_000;

type Entry<T> = { at: number; value: T | null; pending: Promise<T> | null };
const g = globalThis as unknown as { __worldviewMarkets?: { treasury: Entry<Quote[]> } };
const cache = (g.__worldviewMarkets ??= { treasury: { at: 0, value: null, pending: null } });
/** Symbol-keyed caches are bounded LRUs: symbols come from user input. */
const quotes = globalLru<string, Entry<Quote>>("__worldviewQuoteCache", 1000);
const historyCache = globalLru<string, Entry<PriceHistory>>("__worldviewHistoryCache", 400);

async function cached<T>(e: Entry<T>, ttl: number, load: () => Promise<T>): Promise<T> {
  if (e.value && Date.now() - e.at < ttl) return e.value;
  if (!e.pending) {
    e.pending = load()
      .then((v) => {
        e.value = v;
        e.at = Date.now();
        return v;
      })
      .finally(() => {
        e.pending = null;
      });
  }
  try {
    return await e.pending;
  } catch (err) {
    if (e.value) return e.value; // serve stale on failure
    throw err;
  }
}

function failed(symbol: string, name: string, group: Quote["group"], err: unknown): Quote {
  return { symbol, name, group, price: null, change: null, changePct: null, unit: "price", currency: null, asOf: null, spark: [], source: "unavailable", delayed: true, error: err instanceof Error ? err.message : String(err) };
}

export async function getQuote(symbol: string, group: Quote["group"] = "watchlist", name: string | null = null): Promise<Quote> {
  if (!SYMBOL_PATTERN.test(symbol)) return failed(symbol, symbol, group, new Error("Invalid symbol"));
  const inst = INSTRUMENTS.find((i) => i.symbol === symbol);
  let e = quotes.get(symbol);
  if (!e) quotes.set(symbol, (e = { at: 0, value: null, pending: null }));
  try {
    const q = await cached(e, QUOTE_TTL, () =>
      inst?.provider === "coinbase" ? coinbaseQuote(symbol, inst.name) : yahooQuote(symbol, inst?.name ?? name, inst?.group ?? group),
    );
    return { ...q, group: inst?.group ?? group };
  } catch (err) {
    return failed(symbol, inst?.name ?? name ?? symbol, group, err);
  }
}

/** Run with limited concurrency to stay polite to upstreams. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]);
      }
    }),
  );
  return out;
}

export const DISCLAIMER =
  "Market data is for information only and is not investment advice. Index, FX and commodity quotes come from an unofficial, delayed source.";

export async function getMarketSnapshot(): Promise<MarketSnapshot> {
  const nonRates = INSTRUMENTS.filter((i) => i.provider !== "treasury");
  const [quotes, rates] = await Promise.all([
    mapLimit(nonRates, 4, (i) => getQuote(i.symbol, i.group, i.name)),
    cached(cache.treasury, TREASURY_TTL, () => treasuryQuotes()).catch((err) =>
      INSTRUMENTS.filter((i) => i.provider === "treasury").map((i) => failed(i.symbol, i.name, "rates", err)),
    ),
  ]);
  const groups: MarketSnapshot["groups"] = { indices: [], sectors: [], rates, fx: [], bonds: [], volatility: [], commodities: [], crypto: [] };
  for (const q of quotes) if (q.group !== "watchlist" && q.group !== "rates") groups[q.group].push(q);
  return { generatedAt: new Date().toISOString(), groups, disclaimer: DISCLAIMER };
}

/** Country → daily % change of its main index, for the markets choropleth. */
export async function countryIndexChanges(): Promise<Array<{ country: string; symbol: string; name: string; changePct: number | null; asOf: string | null }>> {
  const withCountry = INSTRUMENTS.filter((i) => i.country);
  const quotes = await mapLimit(withCountry, 4, (i) => getQuote(i.symbol, i.group, i.name));
  return withCountry.map((i, k) => ({ country: i.country!, symbol: i.symbol, name: i.name, changePct: quotes[k].changePct, asOf: quotes[k].asOf }));
}

export async function getHistory(symbol: string, range: HistoryRange): Promise<PriceHistory> {
  const key = `${symbol}|${range}`;
  let e = historyCache.get(key);
  if (!e) historyCache.set(key, (e = { at: 0, value: null, pending: null }));
  return cached(e, range === "1d" || range === "5d" ? 2 * 60_000 : 30 * 60_000, () => yahooHistory(symbol, range));
}

const curveEntry: Entry<YieldCurve> = { at: 0, value: null, pending: null };
export async function getYieldCurve(): Promise<YieldCurve> {
  return cached(curveEntry, 6 * 3_600_000, () => treasuryCurve());
}

/**
 * Change of an instrument since a moment in time, measured from hourly closes
 * (5 trading days available). A measurement, not an attribution of cause.
 */
export async function changeSince(symbol: string, sinceMs: number): Promise<{ symbol: string; from: number | null; to: number | null; changePct: number | null; fromTime: string | null } > {
  try {
    const h = await getHistory(symbol, "5d");
    if (!h.points.length || h.points[h.points.length - 1][0] < sinceMs) return { symbol, from: null, to: null, changePct: null, fromTime: null };
    // Baseline = last price at or before the event (the price when it happened); if the
    // event predates the available history, the earliest available price.
    let idx = -1;
    for (let i = 0; i < h.points.length && h.points[i][0] <= sinceMs; i++) idx = i;
    const [t0, from] = h.points[Math.max(idx, 0)];
    const to = h.points[h.points.length - 1][1];
    return { symbol, from, to, changePct: ((to - from) / from) * 100, fromTime: new Date(t0).toISOString() };
  } catch {
    return { symbol, from: null, to: null, changePct: null, fromTime: null };
  }
}
