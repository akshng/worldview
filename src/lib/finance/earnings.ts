/**
 * Earnings releases: 8-K filings with Item 2.02 ("Results of Operations and
 * Financial Condition") from SEC EDGAR full-text search (keyless), last 7 days.
 * An Item 2.02 8-K is how US-listed companies furnish their earnings press release.
 * Cached 1 hour.
 */
import "server-only";
import { userAgent } from "@/lib/env";
import { secGateFetch } from "./sec-http";
import { splitDisplayName } from "./ipos";

export interface EarningsRelease {
  company: string;
  ticker: string | null;
  cik: string | null;
  filed: string;
  /** Period of report (usually the release date, not the quarter end) */
  periodEnding: string | null;
  /** Other 8-K items in the same filing, e.g. ["7.01", "9.01"] */
  otherItems: string[];
  location: string | null;
  url: string;
}

type Hit = {
  _id: string;
  _source: { form?: string; root_forms?: string[]; file_date?: string; period_ending?: string; display_names?: string[]; biz_locations?: string[]; adsh?: string; items?: string[] };
};

export function parseEarnings(hits: Hit[]): EarningsRelease[] {
  const seen = new Set<string>();
  const out: EarningsRelease[] = [];
  for (const h of hits) {
    const s = h._source;
    // The query matches the phrase anywhere; keep only filings that declare Item 2.02.
    if (!s.adsh || !s.file_date || !s.display_names?.[0] || !s.items?.includes("2.02")) continue;
    if (!(s.root_forms ?? [s.form]).some((f) => f === "8-K")) continue;
    if (seen.has(s.adsh)) continue; // the main document and its exhibits are separate hits
    seen.add(s.adsh);
    const { name, ticker, cik } = splitDisplayName(s.display_names[0]);
    const cikNum = cik ? String(Number(cik)) : null;
    const doc = h._id.split(":")[1] ?? "";
    out.push({
      company: name,
      ticker,
      cik: cikNum,
      filed: s.file_date,
      periodEnding: s.period_ending ?? null,
      otherItems: s.items.filter((i) => i !== "2.02"),
      location: s.biz_locations?.[0] ?? null,
      url: cikNum && doc ? `https://www.sec.gov/Archives/edgar/data/${cikNum}/${s.adsh.replace(/-/g, "")}/${doc}` : "https://efts.sec.gov/LATEST/search-index?forms=8-K",
    });
  }
  return out.sort((a, b) => b.filed.localeCompare(a.filed) || a.company.localeCompare(b.company));
}

export interface EarningsFeed {
  releases: EarningsRelease[];
  from: string;
  to: string;
  generatedAt: string;
  source: string;
}

const g = globalThis as unknown as { __worldviewEarnings?: { at: number; value: EarningsFeed } };

export async function getEarningsReleases(days = 7): Promise<EarningsFeed> {
  const hit = g.__worldviewEarnings;
  if (hit && Date.now() - hit.at < 3_600_000) return hit.value;
  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const all: Hit[] = [];
  // Peak earnings weeks bring several hundred filings; 5 pages of 100 covers them.
  for (let page = 0; page < 5; page++) {
    const res = await secGateFetch(
      `https://efts.sec.gov/LATEST/search-index?forms=8-K&q=%22Item%202.02%22&dateRange=custom&startdt=${from}&enddt=${to}&from=${page * 100}`,
      { headers: { "User-Agent": userAgent(), Accept: "application/json" }, signal: AbortSignal.timeout(20_000) },
    );
    if (!res.ok) {
      if (page > 0) break; // keep what we have
      if (hit) return hit.value;
      throw new Error(`HTTP ${res.status}`);
    }
    const j = (await res.json()) as { hits?: { hits?: Hit[]; total?: { value?: number } } };
    all.push(...(j.hits?.hits ?? []));
    if ((j.hits?.total?.value ?? 0) <= (page + 1) * 100) break;
  }
  const value: EarningsFeed = { releases: parseEarnings(all), from, to, generatedAt: new Date().toISOString(), source: "SEC EDGAR full-text search (8-K, Item 2.02)" };
  // An empty result after a non-empty one is more likely an upstream hiccup than a quiet week.
  if (!value.releases.length && hit?.value.releases.length) return hit.value;
  g.__worldviewEarnings = { at: Date.now(), value };
  return value;
}
