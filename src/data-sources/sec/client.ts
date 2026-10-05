import { httpGet, type FetchContext } from "../types";
import type { SecCompany, SecFilingEntry, SecRaw } from "./types";

const FEED = "https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=8-K&count=100&output=atom";
const MAX_LOOKUPS_PER_RUN = 60;

// Company profiles rarely change; cache them for the life of the process.
const g = globalThis as unknown as { __worldviewSecCompanies?: Map<string, SecCompany | null> };
const companyCache = (g.__worldviewSecCompanies ??= new Map());

const tag = (b: string, n: string) => b.match(new RegExp(`<${n}[^>]*>([\\s\\S]*?)</${n}>`))?.[1]?.trim() ?? "";
const decode = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&quot;/g, '"');

export function parseSecAtom(xml: string): SecFilingEntry[] {
  return xml
    .split("<entry>")
    .slice(1)
    .map((e) => {
      const title = decode(tag(e, "title"));
      const m = title.match(/^(\S+)\s+-\s+(.+?)\s+\((\d{10})\)/);
      const summary = decode(tag(e, "summary"));
      return {
        form: m?.[1] ?? "",
        company: m?.[2] ?? title,
        cik: m?.[3] ?? "",
        url: e.match(/<link[^>]*href="([^"]+)"/)?.[1] ?? "",
        accession: tag(e, "id").split("accession-number=")[1] ?? "",
        filedAt: tag(e, "updated"),
        items: [...summary.matchAll(/Item\s+(\d+\.\d+)/g)].map((x) => x[1]),
      };
    })
    .filter((e) => e.cik && e.accession && e.form.startsWith("8-K"));
}

export async function fetchSec(ctx: FetchContext): Promise<SecRaw> {
  const entries = parseSecAtom(await (await httpGet(FEED, ctx, { accept: "application/atom+xml" })).text());
  let lookups = 0;
  for (const e of entries) {
    if (companyCache.has(e.cik) || lookups >= MAX_LOOKUPS_PER_RUN) continue;
    lookups++;
    try {
      const d = await (await httpGet(`https://data.sec.gov/submissions/CIK${e.cik}.json`, ctx)).json();
      const b = d.addresses?.business ?? {};
      companyCache.set(e.cik, {
        cik: e.cik,
        name: d.name ?? e.company,
        tickers: d.tickers ?? [],
        exchanges: d.exchanges ?? [],
        sicDescription: d.sicDescription ?? null,
        city: b.city ?? null,
        stateOrCountry: b.stateOrCountry ?? null,
        countryDescription: b.country ?? b.stateOrCountryDescription ?? null,
      });
    } catch {
      companyCache.set(e.cik, null);
    }
    await new Promise((r) => setTimeout(r, 120)); // SEC fair-access: ≤10 requests/second
  }
  const companies: Record<string, SecCompany> = {};
  for (const e of entries) {
    const c = companyCache.get(e.cik);
    if (c) companies[e.cik] = c;
  }
  return { entries, companies };
}
