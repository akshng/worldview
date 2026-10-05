/**
 * Futures positioning from the CFTC Commitments of Traders report (legacy,
 * futures-only; public Socrata API, keyless). "Speculators" = non-commercial
 * traders. Positions are as of Tuesday, published Friday. Cached 6 hours.
 */
import "server-only";
import { userAgent } from "@/lib/env";

export const COT_MARKETS = [
  { code: "13874A", name: "S&P 500 (E-mini)", group: "Equities" },
  { code: "209742", name: "Nasdaq-100 (E-mini)", group: "Equities" },
  { code: "1170E1", name: "VIX futures", group: "Equities" },
  { code: "042601", name: "2-yr Treasury note", group: "Rates" },
  { code: "043602", name: "10-yr Treasury note", group: "Rates" },
  { code: "020601", name: "Treasury bond", group: "Rates" },
  { code: "098662", name: "US dollar index", group: "Currencies" },
  { code: "099741", name: "Euro", group: "Currencies" },
  { code: "097741", name: "Japanese yen", group: "Currencies" },
  { code: "096742", name: "British pound", group: "Currencies" },
  { code: "067651", name: "WTI crude oil", group: "Commodities" },
  { code: "023651", name: "Natural gas", group: "Commodities" },
  { code: "088691", name: "Gold", group: "Commodities" },
  { code: "084691", name: "Silver", group: "Commodities" },
  { code: "085692", name: "Copper", group: "Commodities" },
  { code: "002602", name: "Corn", group: "Commodities" },
  { code: "005602", name: "Soybeans", group: "Commodities" },
  { code: "001602", name: "Wheat (SRW)", group: "Commodities" },
  { code: "133741", name: "Bitcoin (CME)", group: "Crypto" },
] as const;

export interface CotRow {
  code: string;
  name: string;
  group: string;
  reportDate: string;
  /** Speculators' long − short contracts */
  netSpec: number;
  /** Week-over-week change in netSpec */
  netChange: number | null;
  /** netSpec as % of open interest */
  netPctOi: number;
  /** Where this week's netSpec sits in its own last-3-years range (0 = most short, 100 = most long) */
  percentile3y: number | null;
  openInterest: number;
  /** Weekly netSpec history, oldest first (last ~52 weeks) */
  history: number[];
}

export interface CotReport {
  rows: CotRow[];
  reportDate: string | null;
  source: string;
}

type Raw = {
  cftc_contract_market_code: string;
  report_date_as_yyyy_mm_dd: string;
  open_interest_all: string;
  noncomm_positions_long_all: string;
  noncomm_positions_short_all: string;
};

export function buildCot(raw: Raw[]): CotRow[] {
  const by = new Map<string, Raw[]>();
  for (const r of raw) {
    const list = by.get(r.cftc_contract_market_code) ?? [];
    list.push(r);
    by.set(r.cftc_contract_market_code, list);
  }
  const rows: CotRow[] = [];
  for (const m of COT_MARKETS) {
    const list = (by.get(m.code) ?? []).sort((a, b) => a.report_date_as_yyyy_mm_dd.localeCompare(b.report_date_as_yyyy_mm_dd));
    const nets = list.map((r) => Number(r.noncomm_positions_long_all) - Number(r.noncomm_positions_short_all)).filter(Number.isFinite);
    if (!nets.length) continue;
    const last = list[list.length - 1];
    const net = nets[nets.length - 1];
    const oi = Number(last.open_interest_all);
    const lo = Math.min(...nets), hi = Math.max(...nets);
    rows.push({
      code: m.code,
      name: m.name,
      group: m.group,
      reportDate: last.report_date_as_yyyy_mm_dd.slice(0, 10),
      netSpec: net,
      netChange: nets.length > 1 ? net - nets[nets.length - 2] : null,
      netPctOi: oi > 0 ? Math.round((net / oi) * 1000) / 10 : 0,
      percentile3y: nets.length >= 26 && hi > lo ? Math.round(((net - lo) / (hi - lo)) * 100) : null,
      openInterest: oi,
      history: nets.slice(-52),
    });
  }
  return rows;
}

const TTL = 6 * 3_600_000;
const g = globalThis as unknown as { __worldviewCot?: { at: number; value: CotReport } };

export async function getCot(): Promise<CotReport> {
  const hit = g.__worldviewCot;
  if (hit && Date.now() - hit.at < TTL) return hit.value;
  const since = new Date(Date.now() - 3 * 365 * 86_400_000).toISOString().slice(0, 10);
  const codes = COT_MARKETS.map((m) => `'${m.code}'`).join(",");
  const params = new URLSearchParams({
    $select: "cftc_contract_market_code,report_date_as_yyyy_mm_dd,open_interest_all,noncomm_positions_long_all,noncomm_positions_short_all",
    $where: `cftc_contract_market_code in(${codes}) AND report_date_as_yyyy_mm_dd >= '${since}'`,
    $order: "report_date_as_yyyy_mm_dd",
    $limit: "5000",
  });
  const res = await fetch(`https://publicreporting.cftc.gov/resource/6dca-aqww.json?${params}`, {
    headers: { "User-Agent": userAgent(), Accept: "application/json" },
    signal: AbortSignal.timeout(45_000),
    cache: "no-store",
  });
  if (!res.ok) {
    if (hit) return hit.value;
    throw new Error(`HTTP ${res.status}`);
  }
  const rows = buildCot((await res.json()) as Raw[]);
  const value: CotReport = { rows, reportDate: rows.map((r) => r.reportDate).sort().pop() ?? null, source: "CFTC Commitments of Traders (legacy, futures only)" };
  g.__worldviewCot = { at: Date.now(), value };
  return value;
}
