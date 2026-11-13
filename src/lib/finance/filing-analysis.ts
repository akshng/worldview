/**
 * 10-K filing analysis.
 *
 *  1. Deterministic financials from XBRL company facts (data.sec.gov, always available):
 *     the selected fiscal year vs the prior year, as reported in that same filing.
 *  2. Filing text (only when WORLDVIEW_CONTACT is set — www.sec.gov/Archives
 *     rejects automated clients without a contact): Items 1, 1A, 7 and 7A.
 *  3. AI interpretation (optional) written only from 1 + 2, map-reduced to fit
 *     the local model's context.
 *
 * Finished analyses are cached at DATA_DIR/filings/<accession>.json.
 */
import "server-only";
import path from "node:path";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { env, userAgent } from "@/lib/env";
import { secGateFetch } from "./sec-http";
import { getAIProvider } from "@/lib/ai";
import { FILING_SECTION_TITLES } from "@/lib/ai/prompts";
import type { FilingFactForAI } from "@/lib/ai/types";
import { companyProfile, type AnnualReport } from "./company";
import {
  FILING_DISCLAIMER,
  formatFactChange,
  formatFactValue,
  type FactUnit,
  type FilingAnalysis,
  type FilingFact,
  type FilingFacts,
  type FilingJobStatus,
  type FilingSectionId,
} from "./filing-format";

// ── 1. Financials from XBRL ─────────────────────────────────────────────────

export interface XbrlRow {
  start?: string;
  end: string;
  val: number;
  accn?: string;
  form?: string;
  filed?: string;
}
type Units = Record<string, XbrlRow[]>;
export type CompanyFacts = { facts?: Record<string, Record<string, { units?: Units }>> };

const DAY = 86_400_000;
const days = (a: string, b: string) => Math.abs(Date.parse(b) - Date.parse(a)) / DAY;
const isAnnual = (r: XbrlRow) => !!r.start && days(r.start, r.end) >= 330 && days(r.start, r.end) <= 380;
const latestFiled = (a: XbrlRow, b: XbrlRow) => ((b.filed ?? "") > (a.filed ?? "") ? b : a);

/**
 * Fiscal-year value pair for a duration fact. Prefers the figures reported in
 * the selected filing itself (a 10-K restates the prior years as comparatives).
 */
export function annualPair(rows: XbrlRow[], accession: string, periodEnd: string | null): { cur: XbrlRow | null; prior: XbrlRow | null } {
  const annual = rows.filter(isAnnual);
  const own = annual.filter((r) => r.accn === accession);
  let cur: XbrlRow | null = null;
  if (periodEnd) {
    const near = (own.length ? own : annual).filter((r) => days(r.end, periodEnd) <= 15);
    cur = near.length ? near.reduce(latestFiled) : null;
  } else if (own.length) {
    cur = own.reduce((a, b) => (b.end > a.end ? b : a));
  }
  if (!cur) return { cur: null, prior: null };
  const priorNear = (list: XbrlRow[]) => list.filter((r) => r.end < cur!.end && Math.abs(days(r.end, cur!.end) - 365) <= 20);
  const ownPrior = priorNear(own);
  const anyPrior = priorNear(annual);
  const prior = ownPrior.length ? ownPrior.reduce(latestFiled) : anyPrior.length ? anyPrior.reduce(latestFiled) : null;
  return { cur, prior };
}

/** Point-in-time value at a date (± 7 days), preferring the selected filing. */
export function instantAt(rows: XbrlRow[], accession: string, date: string | null): XbrlRow | null {
  if (!date) return null;
  const near = rows.filter((r) => !r.start && days(r.end, date) <= 7);
  const own = near.filter((r) => r.accn === accession);
  const list = own.length ? own : near;
  return list.length ? list.reduce(latestFiled) : null;
}

type Pair = { cur: number | null; prior: number | null; tag: string | null };

const DURATION: Array<{ key: string; label: string; tags: string[]; unit: "USD" | "USD/shares" | "shares" }> = [
  { key: "revenue", label: "Revenue", tags: ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "RevenueFromContractWithCustomerIncludingAssessedTax", "SalesRevenueNet"], unit: "USD" },
  { key: "grossProfit", label: "Gross profit", tags: ["GrossProfit"], unit: "USD" },
  { key: "operatingIncome", label: "Operating income", tags: ["OperatingIncomeLoss"], unit: "USD" },
  { key: "netIncome", label: "Net income", tags: ["NetIncomeLoss", "ProfitLoss"], unit: "USD" },
  { key: "eps", label: "Diluted EPS", tags: ["EarningsPerShareDiluted", "EarningsPerShareBasicAndDiluted"], unit: "USD/shares" },
  { key: "ocf", label: "Operating cash flow", tags: ["NetCashProvidedByUsedInOperatingActivities"], unit: "USD" },
  { key: "capex", label: "Capital expenditure", tags: ["PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets"], unit: "USD" },
  { key: "rnd", label: "R&D expense", tags: ["ResearchAndDevelopmentExpense", "ResearchAndDevelopmentExpenseExcludingAcquiredInProcessCost"], unit: "USD" },
  { key: "dilutedShares", label: "Diluted shares (weighted avg.)", tags: ["WeightedAverageNumberOfDilutedSharesOutstanding"], unit: "shares" },
];

const INSTANT: Array<{ key: string; label: string; tags: string[] }> = [
  { key: "cash", label: "Cash & equivalents", tags: ["CashAndCashEquivalentsAtCarryingValue", "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents"] },
  { key: "ltDebtTotal", label: "", tags: ["LongTermDebt"] },
  { key: "ltDebtNoncurrent", label: "", tags: ["LongTermDebtNoncurrent"] },
  { key: "ltDebtCurrent", label: "", tags: ["LongTermDebtCurrent"] },
  { key: "shortDebt", label: "", tags: ["CommercialPaper", "ShortTermBorrowings"] },
  { key: "equity", label: "Shareholders' equity", tags: ["StockholdersEquity", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"] },
];

const pctChange = (cur: number | null, prior: number | null) => (cur === null || prior === null || prior === 0 ? null : ((cur - prior) / Math.abs(prior)) * 100);
const ratio = (a: number | null, b: number | null) => (a === null || b === null || b === 0 ? null : a / b);
const round = (v: number | null, d = 4) => (v === null || !Number.isFinite(v) ? null : Math.round(v * 10 ** d) / 10 ** d);

/**
 * Selected fiscal year vs prior year from SEC company facts. Pure.
 * `periodEnd` is the report period from the submissions index (may be null).
 */
export function computeFilingFacts(companyFacts: CompanyFacts, accession: string, periodEnd: string | null): FilingFacts {
  const gaap = companyFacts.facts?.["us-gaap"] ?? {};
  const rowsFor = (tag: string, unit: string) => gaap[tag]?.units?.[unit] ?? [];

  // Anchor the fiscal year on the first revenue / net income tag reported in this filing.
  let end = periodEnd;
  if (!end) {
    for (const tag of [...DURATION[0].tags, "NetIncomeLoss"]) {
      const { cur } = annualPair(rowsFor(tag, "USD"), accession, null);
      if (cur) {
        end = cur.end;
        break;
      }
    }
  }

  const d: Record<string, Pair> = {};
  let priorEnd: string | null = null;
  for (const f of DURATION) {
    d[f.key] = { cur: null, prior: null, tag: null };
    for (const tag of f.tags) {
      const { cur, prior } = annualPair(rowsFor(tag, f.unit), accession, end);
      if (!cur) continue;
      d[f.key] = { cur: cur.val, prior: prior?.val ?? null, tag };
      if (prior && !priorEnd) priorEnd = prior.end;
      if (!end) end = cur.end;
      break;
    }
  }
  if (end && !priorEnd) priorEnd = new Date(Date.parse(end) - 364 * DAY).toISOString().slice(0, 10);

  const inst: Record<string, Pair> = {};
  for (const f of INSTANT) {
    inst[f.key] = { cur: null, prior: null, tag: null };
    for (const tag of f.tags) {
      const rows = rowsFor(tag, "USD");
      const cur = instantAt(rows, accession, end);
      if (!cur) continue;
      inst[f.key] = { cur: cur.val, prior: instantAt(rows, accession, priorEnd)?.val ?? null, tag };
      break;
    }
  }

  // Total debt = long-term debt incl. current portion (or its two parts) + commercial paper / short-term borrowings.
  const debtAt = (which: "cur" | "prior"): { v: number | null; src: string[] } => {
    const src: string[] = [];
    let lt: number | null = null;
    if (inst.ltDebtTotal[which] !== null) {
      lt = inst.ltDebtTotal[which];
      src.push("LongTermDebt");
    } else if (inst.ltDebtNoncurrent[which] !== null || inst.ltDebtCurrent[which] !== null) {
      lt = (inst.ltDebtNoncurrent[which] ?? 0) + (inst.ltDebtCurrent[which] ?? 0);
      src.push("LongTermDebtNoncurrent + LongTermDebtCurrent");
    }
    const st = inst.shortDebt[which];
    if (st !== null) src.push(inst.shortDebt.tag!);
    if (lt === null && st === null) return { v: null, src };
    return { v: (lt ?? 0) + (st ?? 0), src };
  };
  const debtCur = debtAt("cur"), debtPrior = debtAt("prior");

  const lines: FilingFact[] = [];
  const missing: string[] = [];
  const add = (key: string, label: string, unit: FactUnit, cur: number | null, prior: number | null, source: string | null) => {
    if (cur === null) {
      missing.push(label);
      return;
    }
    const change = unit === "percent" || unit === "ratio" ? (prior === null ? null : cur - prior) : pctChange(cur, prior);
    lines.push({ key, label, unit, current: round(cur, unit === "USD" || unit === "shares" ? 0 : 4), prior: round(prior, unit === "USD" || unit === "shares" ? 0 : 4), change: round(change, 2), source: source ?? "" });
  };
  const margin = (num: Pair, den: Pair) => ({ cur: num.cur !== null ? ratio(num.cur, den.cur) : null, prior: num.prior !== null ? ratio(num.prior, den.prior) : null });
  const pct = (x: { cur: number | null; prior: number | null }) => ({ cur: x.cur === null ? null : x.cur * 100, prior: x.prior === null ? null : x.prior * 100 });

  const rev = d.revenue;
  add("revenue", "Revenue", "USD", rev.cur, rev.prior, rev.tag);
  add("grossProfit", "Gross profit", "USD", d.grossProfit.cur, d.grossProfit.prior, d.grossProfit.tag);
  const gm = pct(margin(d.grossProfit, rev));
  add("grossMargin", "Gross margin", "percent", gm.cur, gm.prior, "Gross profit ÷ revenue");
  add("operatingIncome", "Operating income", "USD", d.operatingIncome.cur, d.operatingIncome.prior, d.operatingIncome.tag);
  const om = pct(margin(d.operatingIncome, rev));
  add("operatingMargin", "Operating margin", "percent", om.cur, om.prior, "Operating income ÷ revenue");
  add("netIncome", "Net income", "USD", d.netIncome.cur, d.netIncome.prior, d.netIncome.tag);
  const nm = pct(margin(d.netIncome, rev));
  add("netMargin", "Net margin", "percent", nm.cur, nm.prior, "Net income ÷ revenue");
  add("eps", "Diluted EPS", "USD/share", d.eps.cur, d.eps.prior, d.eps.tag);
  add("ocf", "Operating cash flow", "USD", d.ocf.cur, d.ocf.prior, d.ocf.tag);
  add("capex", "Capital expenditure", "USD", d.capex.cur, d.capex.prior, d.capex.tag);
  const fcf = (w: "cur" | "prior") => (d.ocf[w] === null || d.capex[w] === null ? null : d.ocf[w]! - d.capex[w]!);
  add("fcf", "Free cash flow", "USD", fcf("cur"), fcf("prior"), "Operating cash flow − capital expenditure");
  add("rnd", "R&D expense", "USD", d.rnd.cur, d.rnd.prior, d.rnd.tag);
  const rp = pct(margin(d.rnd, rev));
  add("rndPct", "R&D % of revenue", "percent", rp.cur, rp.prior, "R&D expense ÷ revenue");
  add("cash", "Cash & equivalents", "USD", inst.cash.cur, inst.cash.prior, inst.cash.tag);
  add("debt", "Total debt", "USD", debtCur.v, debtPrior.v, debtCur.src.join(" + ") || null);
  add("equity", "Shareholders' equity", "USD", inst.equity.cur, inst.equity.prior, inst.equity.tag);
  add("debtToEquity", "Debt / equity", "ratio", ratio(debtCur.v, inst.equity.cur), ratio(debtPrior.v, inst.equity.prior), "Total debt ÷ shareholders' equity");
  add("dilutedShares", "Diluted shares (weighted avg.)", "shares", d.dilutedShares.cur, d.dilutedShares.prior, d.dilutedShares.tag);

  return { periodEnd: end, priorPeriodEnd: priorEnd, lines, missing };
}

/** Facts formatted for the model, so it never has to scale or compute numbers. */
export function factsForAI(f: FilingFacts): FilingFactForAI[] {
  return f.lines.map((l) => ({ label: l.label, current: formatFactValue(l.current, l.unit), prior: formatFactValue(l.prior, l.unit), change: formatFactChange(l) }));
}

// ── 2. Filing text ──────────────────────────────────────────────────────────

const ENTITIES: Record<string, string> = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", mdash: "—", ndash: "–", bull: "•", hellip: "…", reg: "®", trade: "™", copy: "©", sect: "§" };

/** Strip a (possibly inline-XBRL) HTML filing to plain text, one block per line. Pure. */
export function htmlToText(html: string): string {
  return html
    .replace(/<ix:header>[\s\S]*?<\/ix:header>/gi, " ")
    .replace(/<(script|style|head|title)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/(td|th)>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?(p|div|tr|table|tbody|thead|li|ul|ol|h[1-6]|section|article|center|blockquote|hr)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m)
    .replace(/[    ​]/g, " ")
    .replace(/[ \t\f\v]+/g, " ")
    .split("\n")
    .map((l) => l.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** 10-K items in document order. */
const ITEMS = ["1", "1A", "1B", "1C", "2", "3", "4", "5", "6", "7", "7A", "8", "9", "9A", "9B", "9C", "10", "11", "12", "13", "14", "15", "16"];
const TARGETS: Record<FilingSectionId, string> = { business: "1", riskFactors: "1A", mdna: "7", marketRisk: "7A" };

export type ExtractedSections = Partial<Record<FilingSectionId, string>>;

/**
 * Find Items 1, 1A, 7 and 7A in 10-K text. Item headings must start a line
 * ("Item 1A." / "ITEM 1A —" / "Item 1A: Risk Factors"). Each heading occurrence
 * runs to the next heading of a later item; the table of contents produces
 * short spans, so the occurrence with the most following text wins. Pure.
 */
export function extractSections(text: string): ExtractedSections {
  const heads: Array<{ order: number; pos: number; bodyStart: number }> = [];
  const re = /^[ \t]*item[ \t]*(\d{1,2}[a-c]?)(?![0-9a-z])[ \t]*[.:\-—–]?/gim;
  for (const m of text.matchAll(re)) {
    const order = ITEMS.indexOf(m[1].toUpperCase());
    if (order >= 0) heads.push({ order, pos: m.index!, bodyStart: m.index! + m[0].length });
  }
  const out: ExtractedSections = {};
  for (const [id, item] of Object.entries(TARGETS) as Array<[FilingSectionId, string]>) {
    const order = ITEMS.indexOf(item);
    let best: { start: number; end: number; closed: boolean } | null = null;
    for (const h of heads) {
      if (h.order !== order) continue;
      const next = heads.find((x) => x.pos > h.pos && x.order > order);
      const cand = { start: h.bodyStart, end: next ? next.pos : text.length, closed: !!next };
      // Spans closed by a later item heading beat open-ended ones; then the longest wins.
      if (!best || (cand.closed && !best.closed) || (cand.closed === best.closed && cand.end - cand.start > best.end - best.start)) best = cand;
    }
    if (!best) continue;
    const body = text.slice(best.start, best.end).trim();
    if (body.length >= 200) out[id] = body;
  }
  return out;
}

// ── 3. Jobs, cache and orchestration ────────────────────────────────────────

export const ACCESSION_RE = /^\d{10}-\d{2}-\d{6}$/;
const TEN_K = /^10-K/;

interface Job {
  status: "running" | "done" | "error";
  step: string | null;
  steps: string[];
  error: string | null;
  result: FilingAnalysis | null;
  at: number;
}

const g = globalThis as unknown as { __worldviewFilingJobs?: Map<string, Job> };
const jobs = (g.__worldviewFilingJobs ??= new Map());

const cacheFile = (accession: string) => path.resolve(process.cwd(), env().DATA_DIR, "filings", `${accession}.json`);
const hasContact = () => !!env().WORLDVIEW_CONTACT?.trim();

/** A cached analysis is reused unless it was financials-only and the full text can now be read. */
export async function cachedAnalysis(accession: string): Promise<FilingAnalysis | null> {
  if (!ACCESSION_RE.test(accession)) return null;
  try {
    const a = JSON.parse(await readFile(cacheFile(accession), "utf8")) as FilingAnalysis;
    if (a.mode === "financials-only" && hasContact()) return null;
    return a;
  } catch {
    return null;
  }
}

async function storeAnalysis(a: FilingAnalysis) {
  const file = cacheFile(a.accession);
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(a));
  await rename(tmp, file);
}

const toStatus = (j: Job | undefined, cached: FilingAnalysis | null): FilingJobStatus =>
  cached
    ? { status: "done", step: null, steps: [], error: null, result: cached }
    : j
      ? { status: j.status, step: j.step, steps: j.steps, error: j.error, result: j.result }
      : { status: "none", step: null, steps: [], error: null, result: null };

export async function filingAnalysisStatus(accession: string): Promise<FilingJobStatus> {
  const j = jobs.get(accession);
  if (j?.status === "running") return toStatus(j, null);
  return toStatus(j, await cachedAnalysis(accession));
}

/** Start (or join) the analysis of one 10-K. Returns immediately; poll filingAnalysisStatus. */
export async function startFilingAnalysis(ticker: string, accession: string): Promise<FilingJobStatus> {
  const existing = jobs.get(accession);
  if (existing?.status === "running") return toStatus(existing, null);
  const cached = await cachedAnalysis(accession);
  if (cached) return toStatus(undefined, cached);
  const job: Job = { status: "running", step: "Looking up the filing…", steps: [], error: null, result: null, at: Date.now() };
  jobs.set(accession, job);
  // Drop finished jobs after an hour (results that matter are on disk).
  for (const [k, v] of jobs) if (v.status !== "running" && Date.now() - v.at > 3_600_000) jobs.delete(k);
  void runJob(job, ticker, accession);
  return toStatus(job, null);
}

const secHeaders = (accept: string) => ({ "User-Agent": userAgent(), Accept: accept });

async function runJob(job: Job, ticker: string, accession: string) {
  const step = (s: string) => {
    if (job.step) job.steps.push(job.step);
    job.step = s;
  };
  try {
    const profile = await companyProfile(ticker);
    if (!profile) throw new Error(`No SEC registrant found for ${ticker}.`);
    const report: AnnualReport | undefined = profile.annualReports.find((r) => r.accession === accession);
    if (!report) throw new Error("That filing isn't one of this company's annual reports.");
    if (!TEN_K.test(report.form)) throw new Error(`${report.form} analysis isn't supported yet (10-K only).`);

    step("Reading XBRL financial data…");
    const res = await secGateFetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${profile.cik}.json`, { headers: secHeaders("application/json"), signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`SEC company facts HTTP ${res.status}`);
    const facts = computeFilingFacts((await res.json()) as CompanyFacts, accession, report.period);

    const notices: string[] = [];
    let text: ExtractedSections | null = null;
    if (!hasContact()) {
      notices.push("Financials-only analysis — set WORLDVIEW_CONTACT=<your email> in .env.local to let WorldView read the full 10-K text (SEC requires a contact for automated access).");
    } else {
      step("Reading the filing…");
      try {
        const doc = await secGateFetch(report.url, { headers: secHeaders("text/html"), signal: AbortSignal.timeout(60_000) });
        if (!doc.ok) throw new Error(`HTTP ${doc.status}`);
        step("Finding Business, Risk Factors and MD&A…");
        text = extractSections(htmlToText(await doc.text()));
        if (!Object.keys(text).length) {
          text = null;
          notices.push("Couldn't locate Items 1, 1A or 7 in the filing text; financials-only analysis.");
        }
      } catch (err) {
        notices.push(`Couldn't read the filing document (${err instanceof Error ? err.message : String(err)}); financials-only analysis.`);
      }
    }

    const ai = getAIProvider();
    let sections: FilingAnalysis["sections"] = null;
    if (!ai) notices.push("AI is turned off — showing computed figures only.");
    else {
      step(text ? "Preparing the AI analysis…" : "Writing the AI analysis from the figures…");
      try {
        sections = await ai.analyzeFiling({
          company: profile.name,
          form: report.form,
          period: report.period ? `fiscal year ended ${report.period}` : `filed ${report.filed}`,
          facts: factsForAI(facts),
          text,
          onProgress: step,
        });
      } catch (err) {
        notices.push(`AI analysis failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    const result: FilingAnalysis = {
      ticker: ticker.toUpperCase(),
      company: profile.name,
      accession,
      form: report.form,
      filed: report.filed,
      period: report.period,
      filingUrl: report.url,
      indexUrl: report.indexUrl,
      facts,
      sections,
      mode: text ? "full" : "financials-only",
      sectionsRead: text ? (Object.entries(text) as Array<[FilingSectionId, string]>).map(([id, t]) => ({ id, title: FILING_SECTION_TITLES[id], chars: t.length })) : [],
      provider: sections ? ai!.name : null,
      model: sections ? ai!.model : null,
      generatedAt: new Date().toISOString(),
      notices,
      disclaimer: FILING_DISCLAIMER,
    };
    // Only AI-complete results are cached; figures-only results are cheap to recompute.
    if (sections) await storeAnalysis(result).catch((err) => console.error("[filing-analysis] cache write failed", err));
    if (job.step) job.steps.push(job.step);
    Object.assign(job, { status: "done", step: null, result, at: Date.now() });
  } catch (err) {
    Object.assign(job, { status: "error", error: err instanceof Error ? err.message : String(err), at: Date.now() });
  }
}
