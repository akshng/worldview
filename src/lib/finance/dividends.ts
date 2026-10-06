/**
 * Dividend history from the Yahoo Finance chart endpoint's `events=div`
 * (unofficial, delayed; keyless). Ex-dividend dates and per-share amounts for the
 * last 5 years, trailing-12-month total and yield. Cached 12 hours per symbol.
 */
import "server-only";
import { userAgent } from "@/lib/env";

export interface DividendPayment {
  /** Ex-dividend date (YYYY-MM-DD) */
  exDate: string;
  amount: number;
}

export interface Dividends {
  symbol: string;
  currency: string | null;
  price: number | null;
  payments: DividendPayment[];
  /** Sum of payments with ex-dates in the last 365 days */
  ttm: number | null;
  /** ttm ÷ current price, % */
  yieldPct: number | null;
  /** Payments per year, estimated from the last 2 years */
  perYear: number | null;
  source: string;
}

type Chart = {
  chart?: {
    result?: Array<{
      meta?: { regularMarketPrice?: number; currency?: string };
      events?: { dividends?: Record<string, { amount?: number; date?: number }> };
    }>;
  };
};

export function parseDividends(symbol: string, j: Chart, now = Date.now()): Dividends {
  const r = j.chart?.result?.[0];
  const price = typeof r?.meta?.regularMarketPrice === "number" && r.meta.regularMarketPrice > 0 ? r.meta.regularMarketPrice : null;
  const byDate = new Map<string, number>();
  for (const d of Object.values(r?.events?.dividends ?? {})) {
    // `date` is the ex-date; the object key is the chart bucket and can differ.
    if (typeof d.amount !== "number" || !(d.amount > 0) || typeof d.date !== "number") continue;
    byDate.set(new Date(d.date * 1000).toISOString().slice(0, 10), d.amount);
  }
  const payments = [...byDate].map(([exDate, amount]) => ({ exDate, amount })).sort((a, b) => a.exDate.localeCompare(b.exDate));
  const since = (days: number) => payments.filter((p) => Date.parse(p.exDate) > now - days * 86_400_000);
  const last = since(365);
  const ttm = last.length ? Math.round(last.reduce((s, p) => s + p.amount, 0) * 10_000) / 10_000 : null;
  const two = since(730).length;
  return {
    symbol,
    currency: r?.meta?.currency ?? null,
    price,
    payments,
    ttm,
    yieldPct: ttm !== null && price ? Math.round((ttm / price) * 10_000) / 100 : null,
    perYear: two ? Math.round(two / 2) || 1 : null,
    source: "Yahoo Finance (unofficial, delayed)",
  };
}

const g = globalThis as unknown as { __worldviewDividends?: Map<string, { at: number; value: Dividends }> };
const cache = (g.__worldviewDividends ??= new Map());

export async function getDividends(symbol: string): Promise<Dividends> {
  const hit = cache.get(symbol);
  if (hit && Date.now() - hit.at < 12 * 3_600_000) return hit.value;
  try {
    const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5y&interval=1mo&events=div`, {
      headers: { "User-Agent": userAgent(), Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const value = parseDividends(symbol, (await res.json()) as Chart);
    cache.set(symbol, { at: Date.now(), value });
    if (cache.size > 300) cache.delete(cache.keys().next().value!);
    return value;
  } catch (e) {
    if (hit) return hit.value;
    throw e;
  }
}
