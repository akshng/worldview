/**
 * Macro dashboard: key US economic indicators from FRED (Federal Reserve Bank of
 * St. Louis) via the keyless fredgraph.csv download, plus the crypto Fear & Greed
 * index (alternative.me). Cached for 6 hours — most series update monthly or daily.
 */
import "server-only";
import { userAgent } from "@/lib/env";

export type MacroGroup = "Inflation" | "Jobs" | "Growth" | "Rates & credit" | "Money & liquidity" | "Housing" | "Sentiment";

interface SeriesDef {
  id: string;
  name: string;
  group: MacroGroup;
  /** How the raw series is turned into the displayed value */
  transform: "level" | "yoy" | "diff" | "thousands" | "trillions_from_millions";
  unit: "%" | "k" | "$T" | "index" | "pp";
  /** One line on what it measures, shown on hover */
  note: string;
}

export const MACRO_SERIES: SeriesDef[] = [
  { id: "CPIAUCSL", name: "CPI inflation", group: "Inflation", transform: "yoy", unit: "%", note: "Consumer prices, % change from a year earlier" },
  { id: "CPILFESL", name: "Core CPI", group: "Inflation", transform: "yoy", unit: "%", note: "CPI excluding food and energy, year over year" },
  { id: "PCEPILFE", name: "Core PCE", group: "Inflation", transform: "yoy", unit: "%", note: "The Fed's preferred inflation gauge, year over year" },
  { id: "T10YIE", name: "10-yr breakeven", group: "Inflation", transform: "level", unit: "%", note: "Inflation the bond market expects over 10 years" },

  { id: "UNRATE", name: "Unemployment rate", group: "Jobs", transform: "level", unit: "%", note: "Share of the labour force without a job" },
  { id: "PAYEMS", name: "Payrolls change", group: "Jobs", transform: "diff", unit: "k", note: "Jobs added in the month (nonfarm payrolls), thousands" },
  { id: "ICSA", name: "Jobless claims", group: "Jobs", transform: "thousands", unit: "k", note: "New weekly unemployment insurance claims, thousands" },
  { id: "SAHMREALTIME", name: "Sahm rule", group: "Jobs", transform: "level", unit: "pp", note: "Recession signal: historically, readings ≥ 0.50 have coincided with the start of US recessions" },

  { id: "A191RL1Q225SBEA", name: "Real GDP growth", group: "Growth", transform: "level", unit: "%", note: "Quarterly growth, seasonally adjusted annual rate" },
  { id: "RSAFS", name: "Retail sales", group: "Growth", transform: "yoy", unit: "%", note: "Retail and food services sales, year over year" },
  { id: "INDPRO", name: "Industrial production", group: "Growth", transform: "yoy", unit: "%", note: "Factory, mining and utility output, year over year" },

  { id: "DFF", name: "Fed funds rate", group: "Rates & credit", transform: "level", unit: "%", note: "Effective federal funds rate (overnight)" },
  { id: "T10Y2Y", name: "10y − 2y spread", group: "Rates & credit", transform: "level", unit: "pp", note: "Below zero = inverted yield curve" },
  { id: "T10Y3M", name: "10y − 3m spread", group: "Rates & credit", transform: "level", unit: "pp", note: "Below zero = inverted yield curve" },
  { id: "BAMLH0A0HYM2", name: "High-yield spread", group: "Rates & credit", transform: "level", unit: "pp", note: "Extra yield on junk bonds over Treasuries — rises when credit stress rises" },
  { id: "STLFSI4", name: "Financial stress", group: "Rates & credit", transform: "level", unit: "index", note: "St. Louis Fed Financial Stress Index (0 = normal)" },

  { id: "M2SL", name: "M2 money supply", group: "Money & liquidity", transform: "yoy", unit: "%", note: "Broad money, year over year" },
  { id: "WALCL", name: "Fed balance sheet", group: "Money & liquidity", transform: "trillions_from_millions", unit: "$T", note: "Total assets held by the Federal Reserve" },

  { id: "MORTGAGE30US", name: "30-yr mortgage", group: "Housing", transform: "level", unit: "%", note: "Average 30-year fixed mortgage rate (Freddie Mac)" },
  { id: "HOUST", name: "Housing starts", group: "Housing", transform: "level", unit: "k", note: "New homes started, seasonally adjusted annual rate, thousands" },

  { id: "UMCSENT", name: "Consumer sentiment", group: "Sentiment", transform: "level", unit: "index", note: "University of Michigan consumer sentiment" },
];

export interface MacroIndicator {
  id: string;
  name: string;
  group: MacroGroup;
  unit: SeriesDef["unit"];
  note: string;
  value: number | null;
  previous: number | null;
  /** value − previous, in the indicator's unit */
  change: number | null;
  /** Observation date of `value` (YYYY-MM-DD) */
  asOf: string | null;
  spark: number[];
  source: string;
  sourceUrl: string;
  /** Text label for categorical readings (Fear & Greed) */
  label?: string | null;
}

export interface MacroDashboard {
  indicators: MacroIndicator[];
  generatedAt: string;
  failed: string[];
}

export type Observation = { date: string; value: number };

/** fredgraph.csv → observations (missing values "." dropped). */
export function parseFredCsv(csv: string): Observation[] {
  const out: Observation[] = [];
  for (const line of csv.trim().split(/\r?\n/).slice(1)) {
    const [date, raw] = line.split(",");
    const value = Number(raw);
    if (/^\d{4}-\d{2}-\d{2}$/.test(date) && raw !== "." && raw !== "" && Number.isFinite(value)) out.push({ date, value });
  }
  return out;
}

/** Apply a transform; returns a series aligned to the input dates where computable. */
export function transformSeries(obs: Observation[], t: SeriesDef["transform"]): Observation[] {
  switch (t) {
    case "level":
      return obs;
    case "thousands":
      return obs.map((o) => ({ date: o.date, value: o.value / 1000 }));
    case "trillions_from_millions":
      return obs.map((o) => ({ date: o.date, value: o.value / 1e6 }));
    case "diff":
      return obs.slice(1).map((o, i) => ({ date: o.date, value: o.value - obs[i].value }));
    case "yoy": {
      const byDate = new Map(obs.map((o) => [o.date, o.value]));
      const out: Observation[] = [];
      for (const o of obs) {
        const prior = byDate.get(`${Number(o.date.slice(0, 4)) - 1}${o.date.slice(4)}`);
        if (prior) out.push({ date: o.date, value: ((o.value - prior) / prior) * 100 });
      }
      return out;
    }
  }
}

/** Keep sparklines light: daily/weekly series sampled to ~weekly over the last year; monthly+ last 36 points. */
export function sparkOf(series: Observation[]): number[] {
  if (series.length < 2) return series.map((o) => o.value);
  const spanDays = (Date.parse(series[series.length - 1].date) - Date.parse(series[series.length - 2].date)) / 86_400_000;
  if (spanDays >= 28) return series.slice(-36).map((o) => o.value);
  const lastYear = series.filter((o) => Date.parse(o.date) >= Date.parse(series[series.length - 1].date) - 365 * 86_400_000);
  const step = spanDays >= 6 ? 1 : 5;
  return lastYear.filter((_, i) => (lastYear.length - 1 - i) % step === 0).map((o) => o.value);
}

const round = (v: number) => Math.round(v * 100) / 100;

export function toIndicator(def: SeriesDef, obs: Observation[]): MacroIndicator {
  const s = transformSeries(obs, def.transform);
  const last = s[s.length - 1] ?? null;
  const prev = s[s.length - 2] ?? null;
  return {
    id: def.id,
    name: def.name,
    group: def.group,
    unit: def.unit,
    note: def.note,
    value: last ? round(last.value) : null,
    previous: prev ? round(prev.value) : null,
    change: last && prev ? round(last.value - prev.value) : null,
    asOf: last?.date ?? null,
    spark: sparkOf(s).map(round),
    source: "FRED, Federal Reserve Bank of St. Louis",
    sourceUrl: `https://fred.stlouisfed.org/series/${def.id}`,
  };
}

async function fetchFred(id: string, since: string): Promise<Observation[]> {
  const res = await fetch(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(id)}&cosd=${since}`, {
    headers: { "User-Agent": userAgent() },
    signal: AbortSignal.timeout(30_000),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return parseFredCsv(await res.text());
}

export function parseFearGreed(j: { data?: Array<{ value: string; value_classification: string; timestamp: string }> }): MacroIndicator | null {
  const rows = (j.data ?? []).filter((r) => Number.isFinite(Number(r.value)));
  if (!rows.length) return null;
  const [now, prev] = rows;
  const v = Number(now.value);
  return {
    id: "CRYPTO_FNG",
    name: "Crypto Fear & Greed",
    group: "Sentiment",
    unit: "index",
    note: "0 = extreme fear, 100 = extreme greed. Built from crypto volatility, momentum, social media and dominance",
    value: v,
    previous: prev ? Number(prev.value) : null,
    change: prev ? v - Number(prev.value) : null,
    asOf: new Date(Number(now.timestamp) * 1000).toISOString().slice(0, 10),
    spark: rows.slice(0, 60).reverse().map((r) => Number(r.value)),
    source: "alternative.me",
    sourceUrl: "https://alternative.me/crypto/fear-and-greed-index/",
    label: now.value_classification,
  };
}

const TTL = 6 * 3_600_000;
const g = globalThis as unknown as { __worldviewMacro?: { at: number; value: MacroDashboard; pending: Promise<MacroDashboard> | null } };

async function load(): Promise<MacroDashboard> {
  const since = `${new Date().getUTCFullYear() - 3}-01-01`;
  const failed: string[] = [];
  const indicators: MacroIndicator[] = [];
  // A few at a time — FRED is a shared public service.
  const queue = [...MACRO_SERIES];
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      for (let def = queue.shift(); def; def = queue.shift()) {
        try {
          indicators.push(toIndicator(def, await fetchFred(def.id, since)));
        } catch {
          failed.push(def.id);
        }
      }
    }),
  );
  try {
    const res = await fetch("https://api.alternative.me/fng/?limit=60", { headers: { "User-Agent": userAgent() }, signal: AbortSignal.timeout(15_000), cache: "no-store" });
    const fng = res.ok ? parseFearGreed(await res.json()) : null;
    if (fng) indicators.push(fng);
    else failed.push("CRYPTO_FNG");
  } catch {
    failed.push("CRYPTO_FNG");
  }
  const order = [...MACRO_SERIES.map((d) => d.id), "CRYPTO_FNG"];
  indicators.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  return { indicators, generatedAt: new Date().toISOString(), failed };
}

export async function getMacroDashboard(): Promise<MacroDashboard> {
  const c = g.__worldviewMacro;
  if (c && Date.now() - c.at < TTL) return c.value;
  if (c?.pending) return c.pending;
  const pending = load().then((value) => {
    // Keep the previous good copy if this refresh came back empty.
    if (value.indicators.length || !g.__worldviewMacro?.value.indicators.length) g.__worldviewMacro = { at: Date.now(), value, pending: null };
    return g.__worldviewMacro?.value ?? value;
  });
  g.__worldviewMacro = { at: c?.at ?? 0, value: c?.value ?? { indicators: [], generatedAt: new Date().toISOString(), failed: [] }, pending };
  try {
    return await pending;
  } finally {
    if (g.__worldviewMacro) g.__worldviewMacro.pending = null;
  }
}
