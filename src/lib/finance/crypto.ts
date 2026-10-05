/** Top cryptocurrencies by market cap (CoinGecko public API, keyless). Cached 5 minutes. */
import "server-only";
import { userAgent } from "@/lib/env";

export interface CryptoRow {
  rank: number;
  id: string;
  symbol: string;
  name: string;
  price: number | null;
  change24h: number | null;
  change7d: number | null;
  marketCap: number | null;
  volume24h: number | null;
  /** 7-day hourly prices, downsampled */
  spark: number[];
}

export interface CryptoMarkets {
  rows: CryptoRow[];
  asOf: string;
  source: string;
}

type Raw = {
  id: string;
  symbol: string;
  name: string;
  market_cap_rank: number | null;
  current_price: number | null;
  market_cap: number | null;
  total_volume: number | null;
  price_change_percentage_24h_in_currency?: number | null;
  price_change_percentage_7d_in_currency?: number | null;
  sparkline_in_7d?: { price?: number[] };
};

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

export function parseCoinMarkets(raw: Raw[]): CryptoRow[] {
  return raw
    .filter((c) => c && typeof c.id === "string" && typeof c.symbol === "string")
    .map((c, i) => {
      const prices = c.sparkline_in_7d?.price ?? [];
      const step = Math.max(1, Math.floor(prices.length / 42));
      return {
        rank: c.market_cap_rank ?? i + 1,
        id: c.id,
        symbol: c.symbol.toUpperCase(),
        name: c.name,
        price: num(c.current_price),
        change24h: num(c.price_change_percentage_24h_in_currency),
        change7d: num(c.price_change_percentage_7d_in_currency),
        marketCap: num(c.market_cap),
        volume24h: num(c.total_volume),
        spark: prices.filter((_, k) => k % step === 0 || k === prices.length - 1),
      };
    });
}

const TTL = 5 * 60_000;
const g = globalThis as unknown as { __worldviewCrypto?: { at: number; value: CryptoMarkets } };

export async function getCryptoMarkets(): Promise<CryptoMarkets> {
  const hit = g.__worldviewCrypto;
  if (hit && Date.now() - hit.at < TTL) return hit.value;
  const res = await fetch(
    "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=20&page=1&sparkline=true&price_change_percentage=24h,7d",
    { headers: { "User-Agent": userAgent(), Accept: "application/json" }, signal: AbortSignal.timeout(20_000), cache: "no-store" },
  );
  if (!res.ok) {
    if (hit) return hit.value; // CoinGecko rate-limits; keep serving the last good copy
    throw new Error(`HTTP ${res.status}${res.status === 429 ? " rate limited" : ""}`);
  }
  const value: CryptoMarkets = { rows: parseCoinMarkets(await res.json()), asOf: new Date().toISOString(), source: "CoinGecko" };
  g.__worldviewCrypto = { at: Date.now(), value };
  return value;
}
