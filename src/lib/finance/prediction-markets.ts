/**
 * Prediction markets from Kalshi's public market-data API (keyless; a CFTC-regulated
 * exchange). Prices are market-implied probabilities, not forecasts. Sports and
 * entertainment are excluded. Cached 15 minutes.
 */
import "server-only";
import { userAgent } from "@/lib/env";

export const PM_GROUPS = {
  economics: { label: "Economics", categories: ["Economics"] },
  financials: { label: "Financials", categories: ["Financials", "Companies", "Business"] },
  politics: { label: "Politics & elections", categories: ["Politics", "Elections"] },
  world: { label: "World & science", categories: ["World", "Climate and Weather", "Science and Technology", "AI", "Health", "Transportation"] },
} as const;
export type PmGroup = keyof typeof PM_GROUPS;

export interface PmOutcome {
  label: string;
  /** Last traded YES price in dollars = implied probability (0–1) */
  prob: number | null;
  /** Change vs the previous day's price, in probability points */
  change: number | null;
}

export interface PmEvent {
  ticker: string;
  title: string;
  category: string;
  group: PmGroup;
  volume24h: number;
  closeTime: string | null;
  outcomes: PmOutcome[];
  url: string;
}

export interface PredictionMarkets {
  events: PmEvent[];
  asOf: string;
  source: string;
}

type RawMarket = { yes_sub_title?: string; title?: string; last_price_dollars?: string; previous_price_dollars?: string; volume_24h_fp?: string; close_time?: string; status?: string };
type RawEvent = { event_ticker: string; series_ticker?: string; title: string; category: string; markets?: RawMarket[] };

const num = (v: string | undefined) => (v !== undefined && v !== "" && Number.isFinite(Number(v)) ? Number(v) : null);

export function buildEvents(raw: RawEvent[], perGroup = 12): PmEvent[] {
  const groupOf = (cat: string) => (Object.entries(PM_GROUPS) as Array<[PmGroup, (typeof PM_GROUPS)[PmGroup]]>).find(([, g]) => (g.categories as readonly string[]).includes(cat))?.[0];
  const events: PmEvent[] = [];
  for (const e of raw) {
    const group = groupOf(e.category);
    if (!group || !e.markets?.length) continue;
    const vol = e.markets.reduce((s, m) => s + (num(m.volume_24h_fp) ?? 0), 0);
    if (vol <= 0) continue;
    const outcomes = e.markets
      .map((m) => {
        const p = num(m.last_price_dollars), prev = num(m.previous_price_dollars);
        return { label: m.yes_sub_title || m.title || "Yes", prob: p, change: p !== null && prev !== null ? Math.round((p - prev) * 1000) / 1000 : null };
      })
      .filter((o) => o.prob !== null)
      .sort((a, b) => (b.prob ?? 0) - (a.prob ?? 0))
      .slice(0, 4);
    if (!outcomes.length) continue;
    events.push({
      ticker: e.event_ticker,
      title: e.title,
      category: e.category,
      group,
      volume24h: Math.round(vol),
      closeTime: e.markets.map((m) => m.close_time).filter(Boolean).sort()[0] ?? null,
      outcomes,
      url: `https://kalshi.com/markets/${encodeURIComponent((e.series_ticker ?? e.event_ticker).toLowerCase())}`,
    });
  }
  const out: PmEvent[] = [];
  for (const g of Object.keys(PM_GROUPS) as PmGroup[]) out.push(...events.filter((e) => e.group === g).sort((a, b) => b.volume24h - a.volume24h).slice(0, perGroup));
  return out;
}

const TTL = 15 * 60_000;
const g = globalThis as unknown as { __worldviewPm?: { at: number; value: PredictionMarkets } };

export async function getPredictionMarkets(): Promise<PredictionMarkets> {
  const hit = g.__worldviewPm;
  if (hit && Date.now() - hit.at < TTL) return hit.value;
  const raw: RawEvent[] = [];
  let cursor = "";
  try {
    for (let page = 0; page < 8; page++) {
      const res = await fetch(`https://api.elections.kalshi.com/trade-api/v2/events?status=open&limit=200&with_nested_markets=true${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, {
        headers: { "User-Agent": userAgent(), Accept: "application/json" },
        signal: AbortSignal.timeout(30_000),
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = (await res.json()) as { events?: RawEvent[]; cursor?: string };
      raw.push(...(j.events ?? []));
      cursor = j.cursor ?? "";
      if (!cursor) break;
    }
  } catch (err) {
    if (hit) return hit.value;
    if (!raw.length) throw err;
  }
  const value: PredictionMarkets = { events: buildEvents(raw), asOf: new Date().toISOString(), source: "Kalshi public market data" };
  g.__worldviewPm = { at: Date.now(), value };
  return value;
}
