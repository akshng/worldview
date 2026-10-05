/**
 * Instrument search across every exchange Yahoo Finance covers (stocks, ETFs,
 * indices, futures, currencies, crypto, funds). Unofficial endpoint; cached 1 h per query.
 */
import "server-only";
import { userAgent } from "@/lib/env";
import { SYMBOL_PATTERN } from "./instruments";

export interface SearchHit {
  symbol: string;
  name: string;
  exchange: string | null;
  type: string;
  sector: string | null;
  industry: string | null;
}

const TYPES: Record<string, string> = {
  EQUITY: "Stock",
  ETF: "ETF",
  INDEX: "Index",
  FUTURE: "Future",
  CURRENCY: "Currency",
  CRYPTOCURRENCY: "Crypto",
  MUTUALFUND: "Fund",
  OPTION: "Option",
};

type RawQuote = { symbol?: string; shortname?: string; longname?: string; exchDisp?: string; quoteType?: string; sector?: string; industry?: string; isYahooFinance?: boolean };

export function parseSearch(j: unknown): SearchHit[] {
  const quotes = ((j as { quotes?: RawQuote[] })?.quotes ?? []) as RawQuote[];
  return quotes
    .filter((q) => typeof q.symbol === "string" && SYMBOL_PATTERN.test(q.symbol) && q.isYahooFinance !== false && q.quoteType !== "OPTION")
    .map((q) => ({
      symbol: q.symbol!,
      name: q.longname ?? q.shortname ?? q.symbol!,
      exchange: q.exchDisp ?? null,
      type: TYPES[q.quoteType ?? ""] ?? q.quoteType ?? "Other",
      sector: q.sector ?? null,
      industry: q.industry ?? null,
    }));
}

const TTL = 3_600_000;
const g = globalThis as unknown as { __worldviewSearch?: Map<string, { at: number; hits: SearchHit[] }> };
const cache = (g.__worldviewSearch ??= new Map());

export async function searchInstruments(query: string): Promise<SearchHit[]> {
  const q = query.trim().toLowerCase();
  const hit = cache.get(q);
  if (hit && Date.now() - hit.at < TTL) return hit.hits;
  const res = await fetch(`https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=12&newsCount=0&listsCount=0&enableFuzzyQuery=false`, {
    headers: { "User-Agent": userAgent(), Accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const hits = parseSearch(await res.json());
  if (cache.size > 2000) cache.clear();
  cache.set(q, { at: Date.now(), hits });
  return hits;
}
