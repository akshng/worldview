/**
 * Company data from SEC EDGAR (keyless; descriptive User-Agent required):
 * ticker → CIK, profile, recent filings, insider (Form 4) activity and
 * reported fundamentals from XBRL company facts.
 */
import "server-only";
import { userAgent } from "@/lib/env";

export interface CompanyFiling {
  form: string;
  filed: string;
  description: string;
  url: string;
}

/** An annual report (10-K, or 20-F / 40-F for foreign private issuers). */
export interface AnnualReport {
  form: string;
  /** SEC accession number, dashed (0000320193-25-000079) */
  accession: string;
  filed: string;
  /** Fiscal period end the report covers (YYYY-MM-DD), when SEC lists it */
  period: string | null;
  /** The report document itself */
  url: string;
  /** The filing's index page (all exhibits, XBRL, financial statements) */
  indexUrl: string;
}

const ANNUAL_FORMS = new Set(["10-K", "10-K/A", "10-KT", "20-F", "20-F/A", "40-F", "40-F/A"]);

/** Annual reports from SEC submissions `filings.recent` columns, newest first. */
export function annualReports(cik: string, r: Record<string, string[] | undefined>, max = 25): AnnualReport[] {
  const out: AnnualReport[] = [];
  const n = r.form?.length ?? 0;
  for (let i = 0; i < n && out.length < max; i++) {
    const form = r.form![i];
    if (!ANNUAL_FORMS.has(form) || !r.accessionNumber?.[i] || !r.primaryDocument?.[i]) continue;
    const accDashed = String(r.accessionNumber[i]);
    const acc = accDashed.replace(/-/g, "");
    const base = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${acc}`;
    out.push({
      form,
      accession: accDashed,
      filed: r.filingDate?.[i] ?? "",
      period: r.reportDate?.[i] || null,
      url: `${base}/${r.primaryDocument[i]}`,
      indexUrl: `${base}/${accDashed}-index.htm`,
    });
  }
  return out;
}

export interface Fundamental {
  label: string;
  value: number;
  unit: string;
  period: string; // e.g. "Q2 FY2026 (to 2026-03-28)"
  priorValue: number | null; // same quarter a year earlier
  filed: string;
}

export interface CompanyProfile {
  cik: string;
  name: string;
  tickers: string[];
  exchanges: string[];
  industry: string | null;
  hq: string | null;
  fiscalYearEnd: string | null;
  filings: CompanyFiling[];
  /** Every annual report in SEC's recent-filings window (typically 10+ years), newest first */
  annualReports: AnnualReport[];
  /** EDGAR page listing all of the company's 10-K filings */
  annualReportsUrl: string;
  insiderFilings30d: number;
  fundamentals: Fundamental[];
  /** Latest reported balance-sheet items (point-in-time) */
  balanceSheet: BalanceItem[];
  /** Quarterly revenue, oldest → newest (up to 12 quarters) */
  revenueHistory: QuarterValue[];
  secUrl: string;
}

export interface BalanceItem {
  label: string;
  value: number;
  unit: "USD" | "shares";
  /** Date the value is as of (YYYY-MM-DD) */
  asOf: string;
  form: string;
}

export interface QuarterValue {
  /** Quarter end date */
  end: string;
  value: number;
  /** Fourth quarter derived as annual total − the three reported quarters (10-Ks don't report Q4 alone) */
  derived: boolean;
}

const headers = () => ({ "User-Agent": userAgent(), Accept: "application/json" });
const getJson = async (u: string) => {
  const r = await fetch(u, { headers: headers(), signal: AbortSignal.timeout(30_000), cache: "no-store" });
  if (!r.ok) throw new Error(`SEC HTTP ${r.status}`);
  return r.json();
};

const g = globalThis as unknown as { __worldviewSec?: { tickers: Map<string, string> | null; tickersAt: number; profiles: Map<string, { at: number; p: CompanyProfile }> } };
const cache = (g.__worldviewSec ??= { tickers: null, tickersAt: 0, profiles: new Map() });

export async function cikForTicker(ticker: string): Promise<string | null> {
  if (!cache.tickers || Date.now() - cache.tickersAt > 24 * 3_600_000) {
    const d = (await getJson("https://www.sec.gov/files/company_tickers.json")) as Record<string, { cik_str: number; ticker: string }>;
    cache.tickers = new Map(Object.values(d).map((x) => [x.ticker.toUpperCase(), String(x.cik_str).padStart(10, "0")]));
    cache.tickersAt = Date.now();
  }
  return cache.tickers.get(ticker.toUpperCase().replace(".", "-")) ?? null;
}

const FACTS: Array<{ label: string; tags: string[]; unit: string }> = [
  { label: "Revenue", tags: ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "SalesRevenueNet"], unit: "USD" },
  { label: "Net income", tags: ["NetIncomeLoss"], unit: "USD" },
  { label: "Diluted EPS", tags: ["EarningsPerShareDiluted"], unit: "USD/shares" },
  { label: "Operating cash flow", tags: ["NetCashProvidedByUsedInOperatingActivities"], unit: "USD" },
  { label: "R&D expense", tags: ["ResearchAndDevelopmentExpense", "ResearchAndDevelopmentExpenseExcludingAcquiredInProcessCost"], unit: "USD" },
];

const REVENUE_TAGS = FACTS[0].tags;

const BALANCE: Array<{ label: string; tags: string[]; unit: BalanceItem["unit"]; taxonomy?: "dei" }> = [
  { label: "Total assets", tags: ["Assets"], unit: "USD" },
  { label: "Total liabilities", tags: ["Liabilities"], unit: "USD" },
  { label: "Shareholders' equity", tags: ["StockholdersEquity", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"], unit: "USD" },
  { label: "Cash & equivalents", tags: ["CashAndCashEquivalentsAtCarryingValue", "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents"], unit: "USD" },
  { label: "Long-term debt", tags: ["LongTermDebtNoncurrent", "LongTermDebt"], unit: "USD" },
  { label: "Shares outstanding", tags: ["EntityCommonStockSharesOutstanding"], unit: "shares", taxonomy: "dei" },
];

type FactRow = { start?: string; end: string; val: number; fy: number; fp: string; form: string; filed: string; frame?: string };

/** Latest single-quarter value (by calendar frame CYyyyyQn) and the same quarter a year earlier. */
export function latestQuarter(rows: FactRow[]): { cur: FactRow; prior: FactRow | null } | null {
  const quarters = rows.filter((r) => r.frame && /^CY\d{4}Q[1-4]$/.test(r.frame));
  if (!quarters.length) return null;
  quarters.sort((a, b) => a.end.localeCompare(b.end));
  const cur = quarters[quarters.length - 1];
  const [y, q] = [Number(cur.frame!.slice(2, 6)), cur.frame!.slice(6)];
  const prior = quarters.find((r) => r.frame === `CY${y - 1}${q}`) ?? null;
  return { cur, prior };
}

/** Most recent point-in-time value from a periodic report (balance-sheet items have no start date). */
export function latestInstant(rows: FactRow[]): FactRow | null {
  let best: FactRow | null = null;
  for (const r of rows) {
    if (r.start || !/^(10-K|10-Q|20-F|40-F)/.test(r.form)) continue;
    if (!best || r.end > best.end || (r.end === best.end && r.filed > best.filed)) best = r;
  }
  return best;
}

const spanDays = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 86_400_000;

/**
 * Single-quarter values by period end (latest filing wins). Missing fourth quarters
 * are derived from the 10-K annual total minus the three quarters inside it.
 */
export function quarterlyHistory(rows: FactRow[], max = 12): QuarterValue[] {
  const q = new Map<string, { row: FactRow; derived: boolean }>();
  const annual = new Map<string, FactRow>();
  for (const r of rows) {
    if (!r.start) continue;
    const len = spanDays(r.start, r.end);
    if (len >= 80 && len <= 100) {
      const prev = q.get(r.end);
      if (!prev || r.filed > prev.row.filed) q.set(r.end, { row: r, derived: false });
    } else if (len >= 350 && len <= 380 && /^10-K/.test(r.form)) {
      const prev = annual.get(r.end);
      if (!prev || r.filed > prev.filed) annual.set(r.end, r);
    }
  }
  for (const a of annual.values()) {
    if (q.has(a.end)) continue;
    const inside = [...q.values()].filter((x) => !x.derived && x.row.start! >= a.start! && x.row.end < a.end);
    if (inside.length !== 3) continue;
    const lastEnd = inside.map((x) => x.row.end).sort().at(-1)!;
    q.set(a.end, { row: { ...a, start: lastEnd, val: a.val - inside.reduce((s, x) => s + x.row.val, 0) }, derived: true });
  }
  return [...q.values()]
    .sort((a, b) => a.row.end.localeCompare(b.row.end))
    .slice(-max)
    .map((x) => ({ end: x.row.end, value: x.row.val, derived: x.derived }));
}

export async function companyProfile(ticker: string): Promise<CompanyProfile | null> {
  const cik = await cikForTicker(ticker);
  if (!cik) return null;
  const hit = cache.profiles.get(cik);
  if (hit && Date.now() - hit.at < 3_600_000) return hit.p;

  const [sub, facts] = await Promise.all([
    getJson(`https://data.sec.gov/submissions/CIK${cik}.json`),
    getJson(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`).catch(() => null),
  ]);
  const r = sub.filings?.recent ?? {};
  const filings: CompanyFiling[] = [];
  let insider = 0;
  const cutoff = Date.now() - 30 * 86_400_000;
  for (let i = 0; i < (r.form?.length ?? 0); i++) {
    const form = r.form[i];
    if (form === "4" && Date.parse(r.filingDate[i]) >= cutoff) insider++;
    if (filings.length < 12 && ["10-K", "10-Q", "8-K", "20-F", "6-K", "S-1", "DEF 14A", "SC 13D", "SC 13G"].includes(form)) {
      const acc = String(r.accessionNumber[i]).replace(/-/g, "");
      filings.push({
        form,
        filed: r.filingDate[i],
        description: r.primaryDocDescription?.[i] || (r.items?.[i] ? `Items ${r.items[i]}` : form),
        url: `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${acc}/${r.primaryDocument[i]}`,
      });
    }
  }
  const fundamentals: Fundamental[] = [];
  const gaap = facts?.facts?.["us-gaap"] ?? {};
  for (const f of FACTS) {
    for (const tag of f.tags) {
      const rows = gaap[tag]?.units?.[f.unit] as FactRow[] | undefined;
      const lq = rows && latestQuarter(rows);
      if (!lq) continue;
      fundamentals.push({
        label: f.label,
        value: lq.cur.val,
        unit: f.unit,
        period: `Calendar ${lq.cur.frame!.slice(6)} ${lq.cur.frame!.slice(2, 6)} (quarter ending ${lq.cur.end})`,
        priorValue: lq.prior?.val ?? null,
        filed: lq.cur.filed,
      });
      break;
    }
  }
  const balanceSheet: BalanceItem[] = [];
  for (const item of BALANCE) {
    const tax = item.taxonomy === "dei" ? (facts?.facts?.dei ?? {}) : gaap;
    for (const tag of item.tags) {
      const rows = tax[tag]?.units?.[item.unit] as FactRow[] | undefined;
      const r = rows && latestInstant(rows);
      if (!r) continue;
      balanceSheet.push({ label: item.label, value: r.val, unit: item.unit, asOf: r.end, form: r.form });
      break;
    }
  }
  // Revenue tags change over the years (e.g. SalesRevenueNet → the ASC 606 tag); merge them.
  const revenueHistory = quarterlyHistory(REVENUE_TAGS.flatMap((t) => (gaap[t]?.units?.USD as FactRow[] | undefined) ?? []));
  const b = sub.addresses?.business ?? {};
  const p: CompanyProfile = {
    cik,
    name: sub.name,
    tickers: sub.tickers ?? [],
    exchanges: sub.exchanges ?? [],
    industry: sub.sicDescription ?? null,
    hq: [b.city, b.stateOrCountryDescription ?? b.stateOrCountry].filter(Boolean).join(", ") || null,
    fiscalYearEnd: sub.fiscalYearEnd ?? null,
    filings,
    annualReports: annualReports(cik, r),
    annualReportsUrl: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}&type=10-K&dateb=&owner=include&count=40`,
    insiderFilings30d: insider,
    fundamentals,
    balanceSheet,
    revenueHistory,
    secUrl: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}`,
  };
  cache.profiles.set(cik, { at: Date.now(), p });
  return p;
}
