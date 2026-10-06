/**
 * Macro dashboard: key US economic indicators from FRED (Federal Reserve Bank of
 * St. Louis) via the keyless fredgraph.csv download, plus the crypto Fear & Greed
 * index (alternative.me). Cached for 6 hours — most series update monthly or daily.
 */
import "server-only";
import { userAgent } from "@/lib/env";

export type MacroGroup =
  | "Inflation"
  | "Jobs"
  | "Growth"
  | "Rates & credit"
  | "Money & liquidity"
  | "Housing"
  | "Fiscal"
  | "Global"
  | "Crypto market"
  | "Sentiment";

interface SeriesDef {
  id: string;
  name: string;
  group: MacroGroup;
  /** How the raw series is turned into the displayed value */
  transform: "level" | "yoy" | "diff" | "thousands" | "trillions_from_millions" | "millions_from_thousands";
  unit: "%" | "k" | "M" | "$" | "$T" | "$B" | "index" | "pp" | "ppm" | "Mkm²" | "°C";
  /** One line on what it measures, shown on hover */
  note: string;
}

export const MACRO_SERIES: SeriesDef[] = [
  { id: "CPIAUCSL", name: "CPI inflation", group: "Inflation", transform: "yoy", unit: "%", note: "Consumer prices, % change from a year earlier" },
  { id: "CPILFESL", name: "Core CPI", group: "Inflation", transform: "yoy", unit: "%", note: "CPI excluding food and energy, year over year" },
  { id: "PCEPILFE", name: "Core PCE", group: "Inflation", transform: "yoy", unit: "%", note: "The Fed's preferred inflation gauge, year over year" },
  { id: "PPIFIS", name: "Producer prices (PPI)", group: "Inflation", transform: "yoy", unit: "%", note: "Producer Price Index for final demand, year over year" },
  { id: "GASREGW", name: "Gasoline price", group: "Inflation", transform: "level", unit: "$", note: "US regular gasoline, average retail price per gallon (weekly, EIA)" },
  { id: "T10YIE", name: "10-yr breakeven", group: "Inflation", transform: "level", unit: "%", note: "Inflation the bond market expects over 10 years" },

  { id: "UNRATE", name: "Unemployment rate", group: "Jobs", transform: "level", unit: "%", note: "Share of the labour force without a job" },
  { id: "PAYEMS", name: "Payrolls change", group: "Jobs", transform: "diff", unit: "k", note: "Jobs added in the month (nonfarm payrolls), thousands" },
  { id: "ICSA", name: "Jobless claims", group: "Jobs", transform: "thousands", unit: "k", note: "New weekly unemployment insurance claims, thousands" },
  { id: "JTSJOL", name: "Job openings", group: "Jobs", transform: "level", unit: "k", note: "Job openings (JOLTS), thousands" },
  { id: "CIVPART", name: "Participation rate", group: "Jobs", transform: "level", unit: "%", note: "Share of working-age population in the labour force" },
  { id: "SAHMREALTIME", name: "Sahm rule", group: "Jobs", transform: "level", unit: "pp", note: "Recession signal: historically, readings ≥ 0.50 have coincided with the start of US recessions" },

  { id: "A191RL1Q225SBEA", name: "Real GDP growth", group: "Growth", transform: "level", unit: "%", note: "Quarterly growth, seasonally adjusted annual rate" },
  { id: "RSAFS", name: "Retail sales", group: "Growth", transform: "yoy", unit: "%", note: "Retail and food services sales, year over year" },
  { id: "TOTALSA", name: "Vehicle sales", group: "Growth", transform: "level", unit: "M", note: "Light vehicle sales, seasonally adjusted annual rate, millions" },
  { id: "INDPRO", name: "Industrial production", group: "Growth", transform: "yoy", unit: "%", note: "Factory, mining and utility output, year over year" },

  { id: "DFF", name: "Fed funds rate", group: "Rates & credit", transform: "level", unit: "%", note: "Effective federal funds rate (overnight)" },
  { id: "T10Y2Y", name: "10y − 2y spread", group: "Rates & credit", transform: "level", unit: "pp", note: "Below zero = inverted yield curve" },
  { id: "T10Y3M", name: "10y − 3m spread", group: "Rates & credit", transform: "level", unit: "pp", note: "Below zero = inverted yield curve" },
  { id: "BAMLH0A0HYM2", name: "High-yield spread", group: "Rates & credit", transform: "level", unit: "pp", note: "Extra yield on junk bonds over Treasuries — rises when credit stress rises" },
  { id: "STLFSI4", name: "Financial stress", group: "Rates & credit", transform: "level", unit: "index", note: "St. Louis Fed Financial Stress Index (0 = normal)" },

  { id: "M2SL", name: "M2 money supply", group: "Money & liquidity", transform: "yoy", unit: "%", note: "Broad money, year over year" },
  { id: "WALCL", name: "Fed balance sheet", group: "Money & liquidity", transform: "trillions_from_millions", unit: "$T", note: "Total assets held by the Federal Reserve" },

  { id: "MORTGAGE30US", name: "30-yr mortgage", group: "Housing", transform: "level", unit: "%", note: "Average 30-year fixed mortgage rate (Freddie Mac)" },
  { id: "CSUSHPINSA", name: "Home prices (Case-Shiller)", group: "Housing", transform: "yoy", unit: "%", note: "S&P CoreLogic Case-Shiller US National Home Price Index, year over year" },
  { id: "DRCCLACBS", name: "Credit card delinquency", group: "Housing", transform: "level", unit: "%", note: "Delinquency rate on credit card loans at commercial banks (quarterly)" },
  { id: "HOUST", name: "Housing starts", group: "Housing", transform: "level", unit: "k", note: "New homes started, seasonally adjusted annual rate, thousands" },

  { id: "ECBDFR", name: "ECB deposit rate", group: "Global", transform: "level", unit: "%", note: "European Central Bank deposit facility rate" },
  { id: "IRSTCI01GBM156N", name: "UK overnight rate", group: "Global", transform: "level", unit: "%", note: "UK call money / interbank rate, monthly average (OECD)" },
  { id: "IRSTCI01JPM156N", name: "Japan overnight rate", group: "Global", transform: "level", unit: "%", note: "Japan call money rate, monthly average (OECD)" },
  { id: "CP0000EZ19M086NEST", name: "Euro area inflation", group: "Global", transform: "yoy", unit: "%", note: "Harmonised consumer prices (HICP), year over year (Eurostat)" },
  { id: "IRLTLT01DEM156N", name: "Germany 10-yr", group: "Global", transform: "level", unit: "%", note: "German 10-year government bond yield, monthly (OECD)" },
  { id: "IRLTLT01GBM156N", name: "UK 10-yr gilt", group: "Global", transform: "level", unit: "%", note: "UK 10-year government bond yield, monthly (OECD)" },
  { id: "IRLTLT01JPM156N", name: "Japan 10-yr", group: "Global", transform: "level", unit: "%", note: "Japan 10-year government bond yield, monthly (OECD)" },

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
  /** What `change` compares against, when not the previous release (e.g. "vs a year earlier") */
  changeBasis?: string;
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
    case "millions_from_thousands":
      return obs.map((o) => ({ date: o.date, value: o.value / 1000 }));
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

const getJson = async (url: string) => {
  const res = await fetch(url, { headers: { "User-Agent": userAgent(), Accept: "application/json" }, signal: AbortSignal.timeout(30_000), cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
};

/** Build an indicator from a dated series that needs no FRED transform. */
export function seriesIndicator(
  meta: Pick<MacroIndicator, "id" | "name" | "group" | "unit" | "note" | "source" | "sourceUrl">,
  series: Observation[],
): MacroIndicator | null {
  if (!series.length) return null;
  const s = [...series].sort((a, b) => a.date.localeCompare(b.date));
  const last = s[s.length - 1], prev = s[s.length - 2];
  return {
    ...meta,
    value: round(last.value),
    previous: prev ? round(prev.value) : null,
    change: prev ? round(last.value - prev.value) : null,
    asOf: last.date,
    spark: sparkOf(s).map(round),
  };
}

const TREASURY = "https://api.fiscaldata.treasury.gov/services/api/fiscal_service";

/** Total public debt outstanding (daily), in $ trillions. */
export function parseDebtToPenny(j: { data?: Array<{ record_date: string; tot_pub_debt_out_amt: string }> }): Observation[] {
  return (j.data ?? []).map((r) => ({ date: r.record_date, value: Number(r.tot_pub_debt_out_amt) / 1e12 })).filter((o) => Number.isFinite(o.value));
}

/**
 * Fiscal-year-to-date deficit (positive = deficit) from MTS table 1, in $ billions.
 * Each statement has two "Year-to-Date" rows — the previous fiscal year's total, then
 * the current year so far — so keep the later row (highest print order) per date.
 */
export function parseMtsYtd(j: {
  data?: Array<{ record_date: string; classification_desc: string; current_month_dfct_sur_amt: string; print_order_nbr?: string }>;
}): Observation[] {
  const best = new Map<string, { order: number; value: number }>();
  for (const r of j.data ?? []) {
    if (r.classification_desc !== "Year-to-Date") continue;
    const value = Number(r.current_month_dfct_sur_amt) / 1e9;
    const order = Number(r.print_order_nbr ?? 0);
    const prev = best.get(r.record_date);
    if (Number.isFinite(value) && (!prev || order > prev.order)) best.set(r.record_date, { order, value });
  }
  return [...best].map(([date, { value }]) => ({ date, value }));
}

const day = (unixSeconds: number | string) => new Date(Number(unixSeconds) * 1000).toISOString().slice(0, 10);

async function loadExternal(): Promise<{ indicators: MacroIndicator[]; failed: string[] }> {
  const fiscal = { source: "U.S. Treasury Fiscal Data", group: "Fiscal" as const };
  const crypto = { group: "Crypto market" as const };
  let cg: Promise<{ data?: Record<string, any> }> | null = null; // eslint-disable-line @typescript-eslint/no-explicit-any
  const coingecko = () => (cg ??= getJson("https://api.coingecko.com/api/v3/global"));
  const tasks: Array<[string, () => Promise<MacroIndicator | null>]> = [
    [
      "US_DEBT",
      async () =>
        seriesIndicator(
          { ...fiscal, id: "US_DEBT", name: "US national debt", unit: "$T", note: "Total public debt outstanding (Debt to the Penny)", sourceUrl: "https://fiscaldata.treasury.gov/datasets/debt-to-the-penny/" },
          parseDebtToPenny(await getJson(`${TREASURY}/v2/accounting/od/debt_to_penny?sort=-record_date&page%5Bsize%5D=260&fields=record_date,tot_pub_debt_out_amt`)),
        ),
    ],
    [
      "US_DEFICIT_FYTD",
      async () =>
        seriesIndicator(
          { ...fiscal, id: "US_DEFICIT_FYTD", name: "Deficit, fiscal YTD", unit: "$B", note: "Federal deficit so far this fiscal year (from Oct 1); the year resets each October. Monthly Treasury Statement", sourceUrl: "https://fiscaldata.treasury.gov/datasets/monthly-treasury-statement/" },
          parseMtsYtd(await getJson(`${TREASURY}/v1/accounting/mts/mts_table_1?filter=classification_desc:eq:Year-to-Date&sort=-record_date&page%5Bsize%5D=48&fields=record_date,classification_desc,current_month_dfct_sur_amt,print_order_nbr`)),
        ),
    ],
    [
      "CRYPTO_MCAP",
      async () => {
        const d = (await coingecko()).data;
        const v = d?.total_market_cap?.usd;
        if (typeof v !== "number") return null;
        const pct = d.market_cap_change_percentage_24h_usd;
        return {
          ...crypto,
          id: "CRYPTO_MCAP",
          name: "Crypto market cap",
          unit: "$T",
          note: "Total value of all tracked cryptocurrencies; change is over the last 24 hours",
          value: round(v / 1e12),
          previous: typeof pct === "number" ? round(v / (1 + pct / 100) / 1e12) : null,
          change: typeof pct === "number" ? round((v - v / (1 + pct / 100)) / 1e12) : null,
          asOf: d.updated_at ? day(d.updated_at) : null,
          spark: [],
          source: "CoinGecko",
          sourceUrl: "https://www.coingecko.com/en/global-charts",
        };
      },
    ],
    [
      "BTC_DOMINANCE",
      async () => {
        const d = (await coingecko()).data;
        const v = d?.market_cap_percentage?.btc;
        if (typeof v !== "number") return null;
        return { ...crypto, id: "BTC_DOMINANCE", name: "Bitcoin dominance", unit: "%", note: "Bitcoin's share of total crypto market cap", value: round(v), previous: null, change: null, asOf: d.updated_at ? day(d.updated_at) : null, spark: [], source: "CoinGecko", sourceUrl: "https://www.coingecko.com/en/global-charts" };
      },
    ],
    [
      "DEFI_TVL",
      async () =>
        seriesIndicator(
          { ...crypto, id: "DEFI_TVL", name: "DeFi value locked", unit: "$B", note: "Total value locked in decentralised-finance protocols across all chains", source: "DefiLlama", sourceUrl: "https://defillama.com/" },
          ((await getJson("https://api.llama.fi/v2/historicalChainTvl")) as Array<{ date: number; tvl: number }>).slice(-400).map((r) => ({ date: day(r.date), value: r.tvl / 1e9 })),
        ),
    ],
    [
      "STABLECOINS",
      async () =>
        seriesIndicator(
          { ...crypto, id: "STABLECOINS", name: "Stablecoin supply", unit: "$B", note: "Circulating supply of USD-pegged stablecoins", source: "DefiLlama", sourceUrl: "https://defillama.com/stablecoins" },
          ((await getJson("https://stablecoins.llama.fi/stablecoincharts/all")) as Array<{ date: string; totalCirculatingUSD?: { peggedUSD?: number } }>)
            .slice(-400)
            .filter((r) => typeof r.totalCirculatingUSD?.peggedUSD === "number")
            .map((r) => ({ date: day(r.date), value: r.totalCirculatingUSD!.peggedUSD! / 1e9 })),
        ),
    ],
  ];
  const indicators: MacroIndicator[] = [];
  const failed: string[] = [];
  await Promise.all(
    tasks.map(async ([id, run]) => {
      try {
        const m = await run();
        if (m) indicators.push(m);
        else failed.push(id);
      } catch {
        failed.push(id);
      }
    }),
  );
  return { indicators, failed };
}

const EXTERNAL_ORDER = ["US_DEBT", "US_DEFICIT_FYTD", "CRYPTO_MCAP", "BTC_DOMINANCE", "DEFI_TVL", "STABLECOINS"];

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
  const ext = await loadExternal();
  indicators.push(...ext.indicators);
  failed.push(...ext.failed);
  try {
    const res = await fetch("https://api.alternative.me/fng/?limit=60", { headers: { "User-Agent": userAgent() }, signal: AbortSignal.timeout(15_000), cache: "no-store" });
    const fng = res.ok ? parseFearGreed(await res.json()) : null;
    if (fng) indicators.push(fng);
    else failed.push("CRYPTO_FNG");
  } catch {
    failed.push("CRYPTO_FNG");
  }
  const order = [...MACRO_SERIES.map((d) => d.id), ...EXTERNAL_ORDER, "CRYPTO_FNG"];
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
