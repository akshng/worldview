/**
 * New registration statements (S-1 / F-1) from SEC EDGAR full-text search (keyless).
 * A filer with no ticker yet is likely planning an IPO; one with a ticker is already
 * listed (follow-on offering or resale). Amendments are excluded. Cached 3 hours.
 */
import "server-only";
import { userAgent } from "@/lib/env";

export interface Registration {
  company: string;
  ticker: string | null;
  cik: string | null;
  form: string;
  filed: string;
  location: string | null;
  likelyIpo: boolean;
  url: string;
}

type Hit = { _id: string; _source: { form?: string; file_date?: string; display_names?: string[]; biz_locations?: string[]; adsh?: string; ciks?: string[] } };

/** "Propanc Biopharma, Inc.  (PPCB)  (CIK 0001517681)" → { name, ticker, cik } */
export function splitDisplayName(s: string): { name: string; ticker: string | null; cik: string | null } {
  const cik = s.match(/\(CIK (\d+)\)/)?.[1] ?? null;
  const ticker = s.replace(/\(CIK \d+\)/, "").match(/\(([A-Z0-9.,\- ]{1,20})\)\s*$/)?.[1]?.split(",")[0].trim() ?? null;
  const name = s.replace(/\(CIK \d+\)/, "").replace(/\([A-Z0-9.,\- ]{1,20}\)\s*$/, "").replace(/\s+/g, " ").trim();
  return { name, ticker, cik };
}

export function parseRegistrations(hits: Hit[]): Registration[] {
  const seen = new Set<string>();
  const out: Registration[] = [];
  for (const h of hits) {
    const s = h._source;
    if (!s.form || !["S-1", "F-1"].includes(s.form) || !s.display_names?.[0] || !s.file_date || !s.adsh) continue;
    if (seen.has(s.adsh)) continue;
    seen.add(s.adsh);
    const { name, ticker, cik } = splitDisplayName(s.display_names[0]);
    const doc = h._id.split(":")[1] ?? "";
    const cikNum = cik ? String(Number(cik)) : null;
    out.push({
      company: name,
      ticker,
      cik: cikNum,
      form: s.form,
      filed: s.file_date,
      location: s.biz_locations?.[0] ?? null,
      likelyIpo: !ticker,
      url: cikNum && doc ? `https://www.sec.gov/Archives/edgar/data/${cikNum}/${s.adsh.replace(/-/g, "")}/${doc}` : "https://www.sec.gov/edgar/search/",
    });
  }
  return out.sort((a, b) => b.filed.localeCompare(a.filed));
}

const g = globalThis as unknown as { __worldviewIpos?: { at: number; value: Registration[] } };

export async function getRegistrations(): Promise<Registration[]> {
  const hit = g.__worldviewIpos;
  if (hit && Date.now() - hit.at < 3 * 3_600_000) return hit.value;
  const end = new Date().toISOString().slice(0, 10);
  const start = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  const all: Hit[] = [];
  for (const from of [0, 100]) {
    const res = await fetch(`https://efts.sec.gov/LATEST/search-index?forms=S-1,F-1&dateRange=custom&startdt=${start}&enddt=${end}&from=${from}`, {
      headers: { "User-Agent": userAgent(), Accept: "application/json" },
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
    });
    if (!res.ok) {
      if (from > 0) break; // keep the first page
      if (hit) return hit.value;
      throw new Error(`HTTP ${res.status}`);
    }
    const j = (await res.json()) as { hits?: { hits?: Hit[]; total?: { value?: number } } };
    all.push(...(j.hits?.hits ?? []));
    if ((j.hits?.total?.value ?? 0) <= from + 100) break;
  }
  const value = parseRegistrations(all);
  g.__worldviewIpos = { at: Date.now(), value };
  return value;
}
