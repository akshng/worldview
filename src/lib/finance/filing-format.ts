/**
 * Types and formatting for 10-K analysis, safe to import from client code.
 * The computation itself lives in filing-analysis.ts (server-only).
 */
import type { FilingSections } from "@/lib/ai/types";

export type FactUnit = "USD" | "USD/share" | "shares" | "percent" | "ratio";

/** One computed figure: selected fiscal year vs the prior fiscal year. */
export interface FilingFact {
  key: string;
  label: string;
  current: number | null;
  prior: number | null;
  unit: FactUnit;
  /** % change for amounts, percentage points for margins, absolute change for ratios */
  change: number | null;
  /** XBRL tag(s) or formula the value comes from */
  source: string;
}

export interface FilingFacts {
  /** Fiscal year end of the selected report (YYYY-MM-DD) */
  periodEnd: string | null;
  priorPeriodEnd: string | null;
  lines: FilingFact[];
  /** Labels that couldn't be computed from the reported XBRL tags */
  missing: string[];
}

export type FilingSectionId = "business" | "riskFactors" | "mdna" | "marketRisk";

export interface FilingAnalysis {
  ticker: string;
  company: string;
  accession: string;
  form: string;
  filed: string;
  period: string | null;
  filingUrl: string;
  indexUrl: string;
  facts: FilingFacts;
  /** AI-written interpretation; null when AI is off or failed */
  sections: FilingSections | null;
  mode: "full" | "financials-only";
  /** Filing text sections found and read (full mode) */
  sectionsRead: Array<{ id: FilingSectionId; title: string; chars: number }>;
  provider: string | null;
  model: string | null;
  generatedAt: string;
  /** Why the analysis is limited (no SEC contact, document unreadable, AI off/failed) */
  notices: string[];
  disclaimer: string;
}

export interface FilingJobStatus {
  status: "none" | "running" | "done" | "error";
  step: string | null;
  /** Completed progress steps, oldest first */
  steps: string[];
  error: string | null;
  result: FilingAnalysis | null;
}

export const FILING_DISCLAIMER = "Information only — not investment advice. AI sections are interpretation of the filing, not verified fact.";

const sig = (v: number) => (v > 0 ? "+" : v < 0 ? "−" : "");

export function formatFactValue(v: number | null, unit: FactUnit): string {
  if (v === null) return "—";
  if (unit === "percent") return `${v.toFixed(1)}%`;
  if (unit === "ratio") return `${v.toFixed(2)}x`;
  if (unit === "USD/share") return `${v < 0 ? "−" : ""}$${Math.abs(v).toFixed(2)}`;
  const a = Math.abs(v);
  const s = a >= 1e12 ? `${(a / 1e12).toFixed(2)}T` : a >= 1e9 ? `${(a / 1e9).toFixed(2)}B` : a >= 1e6 ? `${(a / 1e6).toFixed(1)}M` : a.toLocaleString("en-US");
  return unit === "shares" ? `${v < 0 ? "−" : ""}${s} shares` : `${v < 0 ? "−" : ""}$${s}`;
}

export function formatFactChange(f: Pick<FilingFact, "change" | "unit">): string {
  if (f.change === null) return "—";
  const a = Math.abs(f.change);
  if (f.unit === "percent") return `${sig(f.change)}${a.toFixed(1)} pp`;
  if (f.unit === "ratio") return `${sig(f.change)}${a.toFixed(2)}x`;
  return `${sig(f.change)}${a.toFixed(1)}%`;
}
