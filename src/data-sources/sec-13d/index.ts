/**
 * New activist / control stakes from SEC EDGAR Schedule 13D filings (keyless; SEC fair-access
 * rules: an identifying User-Agent with contact and ≤ 10 requests/second — this reads at most
 * ~7/s). The "latest filings" Atom feed lists new SCHEDULE 13D filings; each new filing's full
 * submission text is read once for the subject company's business address (SEC header) and
 * the structured cover page (reporting persons, percent of class, purpose of transaction).
 *
 * Only original filings become events (amendments, 13D/A, are skipped), one per accession, at
 * the subject company's business address.
 */
import type { EventCandidateInput } from "@/types/events";
import { locateAddress } from "@/lib/geo/gazetteer";
import { decodeXmlText } from "../news-rss/client";
import { httpGet, plainText, safeUrl, type DataSourceConnector, type FetchContext, type ParseContext, type ParseResult } from "../types";
import { HQ, clip, isoOrNull, makeSource } from "../official-common";

export interface Sc13dEntry {
  accession: string;
  subjectCik: string;
  subjectName: string;
  filedAt: string;
  url: string;
}
export interface Sc13dFiling extends Sc13dEntry {
  city: string | null;
  state: string | null;
  /** The structured Schedule 13D XML (<edgarSubmission>), trimmed */
  xml: string;
}
export interface Sec13dRaw {
  filings: Sc13dFiling[];
}

const FEED = "https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=SCHEDULE%2013D&count=100&output=atom";
const MAX_FILINGS_PER_RUN = 25;
const MAX_AGE_MS = 3 * 86_400_000;

const g = globalThis as unknown as { __worldview13d?: Map<string, Sc13dFiling | null> };
const filingCache = (g.__worldview13d ??= new Map());

const tag = (b: string, n: string) => b.match(new RegExp(`<${n}(?:\\s[^>]*)?>([\\s\\S]*?)</${n}>`))?.[1]?.trim() ?? "";

/** Original SCHEDULE 13D entries of the feed, one per accession (the subject company's line). */
export function parse13dAtom(xml: string): Sc13dEntry[] {
  const out = new Map<string, Sc13dEntry>();
  for (const e of xml.split("<entry>").slice(1)) {
    const title = decodeXmlText(tag(e, "title"));
    const m = title.match(/^SCHEDULE 13D\s+-\s+(.+?)\s+\((\d{10})\)\s+\(Subject\)/);
    const accession = tag(e, "id").split("accession-number=")[1] ?? "";
    const url = e.match(/<link[^>]*href="([^"]+)"/)?.[1] ?? "";
    if (!m || !/^\d{10}-\d{2}-\d{6}$/.test(accession) || out.has(accession)) continue;
    out.set(accession, { accession, subjectCik: m[2], subjectName: m[1], filedAt: tag(e, "updated"), url });
  }
  return [...out.values()];
}

/** Subject company business city/state (SEC header) and the cover-page XML. */
export function split13dSubmission(txt: string): { city: string | null; state: string | null; xml: string | null } {
  const lines = (txt.split("</SEC-HEADER>")[0] ?? "").split(/\r?\n/);
  const start = lines.findIndex((l) => /^SUBJECT COMPANY:/.test(l));
  const section: string[] = [];
  for (let i = start + 1; start >= 0 && i < lines.length && !/^\S/.test(lines[i]); i++) section.push(lines[i]);
  const b = section.findIndex((l) => /^\s*BUSINESS ADDRESS:/.test(l));
  const business: string[] = [];
  for (let i = b + 1; b >= 0 && i < section.length && !/^\s*[A-Z][A-Z ]+:\s*$/.test(section[i]); i++) business.push(section[i]);
  const val = (k: string) => business.map((l) => l.match(new RegExp(`^\\s*${k}:\\s*(.+)$`))?.[1]?.trim()).find(Boolean) ?? null;
  const xml = txt.match(/<edgarSubmission[\s\S]*?<\/edgarSubmission>/)?.[0] ?? null;
  return { city: val("CITY"), state: val("STATE"), xml: xml ? xml.slice(0, 120_000) : null };
}

export async function fetchSec13d(ctx: FetchContext): Promise<Sec13dRaw> {
  const entries = parse13dAtom(await (await httpGet(FEED, ctx, { accept: "application/atom+xml" })).text());
  const fresh = entries.filter((e) => !filingCache.has(e.accession)).slice(0, MAX_FILINGS_PER_RUN);
  for (const e of fresh) {
    const folder = e.accession.replace(/-/g, "");
    try {
      const txt = await (await httpGet(`https://www.sec.gov/Archives/edgar/data/${Number(e.subjectCik)}/${folder}/${e.accession}.txt`, ctx, { accept: "text/plain" })).text();
      const { city, state, xml } = split13dSubmission(txt);
      filingCache.set(e.accession, xml ? { ...e, city, state, xml } : null);
    } catch (err) {
      if (ctx.signal.aborted) throw err;
    }
    await new Promise((r) => setTimeout(r, 150)); // SEC fair access: ≤ 10 requests/second
  }
  const filings: Sc13dFiling[] = [];
  for (const [acc, f] of filingCache) {
    if (f && ctx.now - Date.parse(f.filedAt) <= MAX_AGE_MS) filings.push(f);
    else if (filingCache.size > 2_000) filingCache.delete(acc);
  }
  return { filings };
}

export interface Cover {
  issuer: string | null;
  cusip: string | null;
  securityClass: string | null;
  eventDate: string | null;
  persons: Array<{ name: string; percent: number | null; shares: number | null }>;
  purpose: string | null;
}

/** "10/26/2026" → "2026-10-26". */
function usDate(s: string): string | null {
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}` : null;
}

export function readCover(xml: string): Cover {
  const text = (n: string, from = xml) => plainText(decodeXmlText(tag(from, n)), 400) || null;
  const persons = (xml.match(/<reportingPersonInfo>[\s\S]*?<\/reportingPersonInfo>/g) ?? []).map((p) => {
    const pct = Number.parseFloat(tag(p, "percentOfClass"));
    const sh = Number.parseFloat(tag(p, "aggregateAmountOwned"));
    return { name: plainText(decodeXmlText(tag(p, "reportingPersonName")), 120), percent: Number.isFinite(pct) ? pct : null, shares: Number.isFinite(sh) ? sh : null };
  }).filter((p) => p.name);
  return {
    issuer: text("issuerName"),
    cusip: text("issuerCusipNumber"),
    securityClass: text("securitiesClassTitle"),
    eventDate: usDate(tag(xml, "dateOfEvent")),
    persons,
    purpose: plainText(decodeXmlText(tag(tag(xml, "item4") || xml, "transactionPurpose")), 600) || null,
  };
}

const titleCase = (s: string) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

export function parseSec13d(raw: Sec13dRaw, ctx: ParseContext): ParseResult {
  const candidates: EventCandidateInput[] = [];
  let skipped = 0;
  for (const f of raw.filings ?? []) {
    const filed = isoOrNull(f.filedAt);
    if (!filed || ctx.now - Date.parse(filed) > MAX_AGE_MS || !/<submissionType>\s*SCHEDULE 13D\s*</.test(f.xml)) {
      skipped++;
      continue;
    }
    const c = readCover(f.xml);
    const company = (c.issuer ?? f.subjectName).replace(/\s+\/[A-Z]{2,3}\/?$/, "");
    const lead = c.persons[0];
    const pct = c.persons.reduce<number | null>((m, p) => (p.percent !== null && (m === null || p.percent > m) ? p.percent : m), null);
    const loc = f.city || f.state ? locateAddress(f.city ? titleCase(f.city) : null, f.state) : null;
    const filer = lead?.name ?? "An investor";
    const leadPct = lead?.percent ?? null;
    const title = clip(`Activist/control stake: ${filer} reports ${leadPct !== null ? `${leadPct}% of ` : "a stake in "}${company} (Schedule 13D)`);
    candidates.push({
      type: "MARKETS",
      subtype: "activist stake (13D)",
      title,
      summary: clip(
        `Schedule 13D filed with the SEC on ${filed.slice(0, 16).replace("T", " ")} UTC: ${c.persons.slice(0, 4).map((p) => `${p.name}${p.percent !== null ? ` (${p.percent}%)` : ""}`).join("; ") || filer} reported beneficial ownership in ${company}` +
          `${c.securityClass ? ` (${c.securityClass}${c.cusip ? `, CUSIP ${c.cusip}` : ""})` : ""}${c.eventDate ? `; event date ${c.eventDate}` : ""}. A 13D means more than 5% held with intent to influence or control.` +
          `${c.purpose ? ` Stated purpose: “${clip(c.purpose, 400)}”` : ""}${loc ? "" : " Shown at SEC headquarters (company address not matched)."}`,
        1990,
      ),
      description: null,
      latitude: loc ? loc.lat : HQ.sec.lat,
      longitude: loc ? loc.lon : HQ.sec.lon,
      geoPrecision: loc ? loc.precision : "city",
      locationName: loc ? loc.label : HQ.sec.name,
      country: loc ? null : "US",
      timestamp: filed,
      metrics: { percent_of_class: pct, shares: lead?.shares ?? null, cusip: c.cusip, reporting_persons: c.persons.length, event_date: c.eventDate },
      entities: [{ type: "ORGANIZATION", name: company, code: null }, ...c.persons.slice(0, 5).map((p) => ({ type: "ORGANIZATION" as const, name: p.name, code: null }))],
      source: makeSource({
        dataSourceId: "sec-13d",
        externalId: f.accession,
        sourceName: "SEC EDGAR — Schedule 13D",
        sourceUrl: safeUrl(f.url),
        title,
        publishedAt: filed,
        retrievedAt: ctx.retrievedAt,
        basis: "Beneficial ownership report (Schedule 13D) filed with the U.S. SEC",
      }),
      rawData: { accession: f.accession, subjectCik: f.subjectCik, persons: c.persons.slice(0, 10) },
    });
  }
  return { candidates, skipped };
}

export const sec13dConnector: DataSourceConnector<Sec13dRaw> = {
  id: "sec-13d",
  name: "SEC 13D activist stakes",
  description: "New Schedule 13D filings (more than 5% with intent to influence or control) from SEC EDGAR, last 3 days, at the target company's address; amendments skipped.",
  homepage: "https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=SCHEDULE%2013D",
  attribution: "U.S. Securities and Exchange Commission — EDGAR (public domain); SEC fair-access rules apply",
  sourceType: "OFFICIAL_AGENCY",
  categories: ["MARKETS"],
  refreshIntervalMs: 15 * 60_000,
  timeoutMs: 60_000,
  mode: "live",
  fetch: fetchSec13d,
  parse: parseSec13d,
};
