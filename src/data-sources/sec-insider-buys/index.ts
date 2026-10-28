/**
 * Market-wide insider PURCHASES from SEC EDGAR Form 4 filings (keyless; SEC fair-access rules:
 * an identifying User-Agent with contact and ≤ 10 requests/second).
 *
 * The "latest filings" Atom feed lists new Form 4s; each new filing's full submission text is
 * read once (SEC header with the issuer's business address + the ownership XML). Only
 * open-market purchases (transaction code P, acquired) totalling ≥ $100,000 become an event —
 * one per filing, at the issuer's business address. Sales, grants, option exercises and
 * amendments are ignored.
 */
import type { EventCandidateInput } from "@/types/events";
import { locateAddress } from "@/lib/geo/gazetteer";
import { decodeXmlText } from "../news-rss/client";
import { httpGet, plainText, safeUrl, type DataSourceConnector, type FetchContext, type ParseContext, type ParseResult } from "../types";
import { HQ, clip, isoOrNull, makeSource } from "../official-common";

export interface Form4Entry {
  accession: string;
  issuerCik: string;
  filedAt: string;
  url: string;
}
export interface Form4Filing extends Form4Entry {
  /** SEC header: issuer business address */
  city: string | null;
  state: string | null;
  /** The <ownershipDocument> XML */
  xml: string;
}
export interface SecInsiderRaw {
  filings: Form4Filing[];
}

const FEED = (start: number) => `https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=4&count=100&start=${start}&output=atom`;
export const MIN_PURCHASE_USD = 100_000;
const MAX_FILINGS_PER_RUN = 60;
const MAX_AGE_MS = 3 * 86_400_000;

// Filings already read in this process (a Form 4 never changes once accepted): the filing when
// it contains a purchase, else null.
const g = globalThis as unknown as { __worldviewForm4?: Map<string, Form4Filing | null> };
const filingCache = (g.__worldviewForm4 ??= new Map());

const tag = (b: string, n: string) => b.match(new RegExp(`<${n}(?:\\s[^>]*)?>([\\s\\S]*?)</${n}>`))?.[1]?.trim() ?? "";

/** Form 4 entries of the latest-filings feed, one per accession (the issuer's line). */
export function parseForm4Atom(xml: string): Form4Entry[] {
  const out = new Map<string, Form4Entry>();
  for (const e of xml.split("<entry>").slice(1)) {
    const title = decodeXmlText(tag(e, "title"));
    const m = title.match(/^(\S+)\s+-\s+.+?\s+\((\d{10})\)\s+\(Issuer\)/);
    const accession = tag(e, "id").split("accession-number=")[1] ?? "";
    const url = e.match(/<link[^>]*href="([^"]+)"/)?.[1] ?? "";
    if (!m || m[1] !== "4" || !/^\d{10}-\d{2}-\d{6}$/.test(accession) || out.has(accession)) continue;
    out.set(accession, { accession, issuerCik: m[2], filedAt: tag(e, "updated"), url });
  }
  return [...out.values()];
}

/** Pull the issuer's business city/state and the ownership XML out of a full submission .txt. */
export function splitSubmission(txt: string): { city: string | null; state: string | null; xml: string | null } {
  const lines = (txt.split("</SEC-HEADER>")[0] ?? "").split(/\r?\n/);
  const start = lines.findIndex((l) => /^ISSUER:/.test(l));
  // The issuer block runs until the next top-level (unindented) header line.
  const section: string[] = [];
  for (let i = start + 1; start >= 0 && i < lines.length && !/^\S/.test(lines[i]); i++) section.push(lines[i]);
  // Its business address runs until the next sub-heading ("MAIL ADDRESS:", "FORMER COMPANY:").
  const b = section.findIndex((l) => /^\s*BUSINESS ADDRESS:/.test(l));
  const business: string[] = [];
  for (let i = b + 1; b >= 0 && i < section.length && !/^\s*[A-Z][A-Z ]+:\s*$/.test(section[i]); i++) business.push(section[i]);
  const val = (k: string) => business.map((l) => l.match(new RegExp(`^\\s*${k}:\\s*(.+)$`))?.[1]?.trim()).find(Boolean) ?? null;
  return { city: val("CITY"), state: val("STATE"), xml: txt.match(/<ownershipDocument>[\s\S]*?<\/ownershipDocument>/)?.[0] ?? null };
}

export async function fetchSecInsider(ctx: FetchContext): Promise<SecInsiderRaw> {
  const entries: Form4Entry[] = [];
  for (const start of [0, 100]) {
    try {
      entries.push(...parseForm4Atom(await (await httpGet(FEED(start), ctx, { accept: "application/atom+xml" })).text()));
    } catch (e) {
      if (start === 0) throw e;
    }
  }
  const fresh = [...new Map(entries.map((e) => [e.accession, e])).values()].filter((e) => !filingCache.has(e.accession)).slice(0, MAX_FILINGS_PER_RUN);
  for (const e of fresh) {
    const folder = e.accession.replace(/-/g, "");
    try {
      const txt = await (await httpGet(`https://www.sec.gov/Archives/edgar/data/${Number(e.issuerCik)}/${folder}/${e.accession}.txt`, ctx, { accept: "text/plain" })).text();
      const { city, state, xml } = splitSubmission(txt);
      // Only filings with a purchase are kept in full; the rest are remembered as read.
      filingCache.set(e.accession, xml && purchasesIn(xml).length ? { ...e, city, state, xml } : null);
    } catch (err) {
      if (ctx.signal.aborted) throw err;
    }
    await new Promise((r) => setTimeout(r, 150)); // SEC fair access: ≤ 10 requests/second
  }
  // Every run re-emits the purchases still inside the age window (stable ids: no duplicates).
  const filings: Form4Filing[] = [];
  for (const [acc, f] of filingCache) {
    const inWindow = f ? ctx.now - Date.parse(f.filedAt) <= MAX_AGE_MS : false;
    if (f && inWindow) filings.push(f);
    else if (filingCache.size > 5_000) filingCache.delete(acc);
  }
  return { filings };
}

const num = (s: string) => {
  const n = Number(s.replace(/[,$\s]/g, ""));
  return Number.isFinite(n) ? n : NaN;
};
const val = (b: string, n: string) => decodeXmlText(tag(tag(b, n) || "", "value") || tag(b, n)).trim();

export interface Purchase {
  date: string;
  shares: number;
  price: number;
  security: string;
}

/** Open-market purchases (code P, acquired) in the non-derivative table. */
export function purchasesIn(xml: string): Purchase[] {
  const out: Purchase[] = [];
  for (const t of xml.match(/<nonDerivativeTransaction>[\s\S]*?<\/nonDerivativeTransaction>/g) ?? []) {
    const code = tag(tag(t, "transactionCoding"), "transactionCode");
    const ad = val(t, "transactionAcquiredDisposedCode");
    const shares = num(val(t, "transactionShares"));
    const price = num(val(t, "transactionPricePerShare"));
    if (code !== "P" || ad !== "A" || !(shares > 0) || !(price > 0)) continue;
    out.push({ date: val(t, "transactionDate").slice(0, 10), shares, price, security: plainText(val(t, "securityTitle"), 80) });
  }
  return out;
}

export function ownerRole(owner: string): string {
  const rel = tag(owner, "reportingOwnerRelationship");
  const yes = (n: string) => /^(1|true)$/i.test(tag(rel, n));
  const title = plainText(decodeXmlText(tag(rel, "officerTitle")), 60);
  const roles = [yes("isOfficer") ? title || "officer" : null, yes("isDirector") ? "director" : null, yes("isTenPercentOwner") ? "10% owner" : null, yes("isOther") ? plainText(decodeXmlText(tag(rel, "otherText")), 40) || "other" : null];
  return roles.filter(Boolean).join(", ");
}

export const usd = (n: number) => (n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(n >= 1e7 ? 1 : 2)}M` : `$${Math.round(n / 1e3)}K`);
const titleCase = (s: string) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

export function parseSecInsider(raw: SecInsiderRaw, ctx: ParseContext): ParseResult {
  const candidates: EventCandidateInput[] = [];
  let skipped = 0;
  for (const f of raw.filings ?? []) {
    const filed = isoOrNull(f.filedAt);
    const buys = purchasesIn(f.xml);
    const total = buys.reduce((s, b) => s + b.shares * b.price, 0);
    if (!filed || ctx.now - Date.parse(filed) > MAX_AGE_MS || !buys.length || total < MIN_PURCHASE_USD) {
      skipped++;
      continue;
    }
    const issuer = tag(f.xml, "issuer");
    // EDGAR conformed names carry a state-of-incorporation suffix: "HEXCEL CORP /DE/".
    const company = plainText(decodeXmlText(tag(issuer, "issuerName")), 120).replace(/\s+\/[A-Z]{2,3}\/?$/, "");
    const ticker = plainText(decodeXmlText(tag(issuer, "issuerTradingSymbol")), 12).toUpperCase() || null;
    const owners = (f.xml.match(/<reportingOwner>[\s\S]*?<\/reportingOwner>/g) ?? []).map((o) => ({
      name: plainText(decodeXmlText(tag(tag(o, "reportingOwnerId"), "rptOwnerName")), 100),
      role: ownerRole(o),
    }));
    const who = owners[0]?.name || "An insider";
    const role = owners[0]?.role;
    const shares = buys.reduce((s, b) => s + b.shares, 0);
    const dates = [...new Set(buys.map((b) => b.date))].sort();
    const avg = total / shares;
    const loc = f.city || f.state ? locateAddress(f.city ? titleCase(f.city) : null, f.state) : null;
    const title = clip(`Insider purchase: ${who}${role ? ` (${role})` : ""} bought ${usd(total)} of ${ticker ?? company}${ticker ? ` — ${company}` : ""}`);
    candidates.push({
      type: "MARKETS",
      subtype: "insider purchase",
      title,
      summary:
        `Form 4 filed with the SEC on ${filed.slice(0, 16).replace("T", " ")} UTC: ${owners.map((o) => (o.role ? `${o.name} (${o.role})` : o.name)).join("; ") || who} reported open-market purchases (code P) of ` +
        `${shares.toLocaleString("en-US")} shares of ${company}${ticker ? ` (${ticker})` : ""} at an average $${avg.toFixed(2)}, about ${usd(total)} in total, on ${dates.join(", ")}.` +
        `${loc ? "" : " Shown at SEC headquarters (issuer address not matched)."}`,
      latitude: loc ? loc.lat : HQ.sec.lat,
      longitude: loc ? loc.lon : HQ.sec.lon,
      geoPrecision: loc ? loc.precision : "city",
      locationName: loc ? loc.label : HQ.sec.name,
      country: loc ? null : "US",
      timestamp: filed,
      metrics: { ticker, value_usd: Math.round(total), shares, avg_price: Math.round(avg * 100) / 100, transactions: buys.length, first_trade_date: dates[0] ?? null },
      entities: [{ type: "ORGANIZATION", name: company, code: ticker }, ...owners.filter((o) => o.name).map((o) => ({ type: "PERSON" as const, name: o.name, code: null }))],
      source: makeSource({
        dataSourceId: "sec-insider-buys",
        externalId: f.accession,
        sourceName: "SEC EDGAR — Form 4",
        sourceUrl: safeUrl(f.url),
        title,
        publishedAt: filed,
        retrievedAt: ctx.retrievedAt,
        basis: "Statement of changes in beneficial ownership (Form 4) filed with the U.S. SEC",
      }),
      rawData: { accession: f.accession, issuerCik: f.issuerCik, buys: buys.slice(0, 20) },
    });
  }
  return { candidates, skipped };
}

export const secInsiderBuysConnector: DataSourceConnector<SecInsiderRaw> = {
  id: "sec-insider-buys",
  name: "Insider purchases (Form 4)",
  description: "Open-market insider purchases of $100K+ reported on SEC Form 4, market-wide, at the issuer's headquarters.",
  homepage: "https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=4",
  attribution: "U.S. Securities and Exchange Commission EDGAR — public domain",
  sourceType: "OFFICIAL_AGENCY",
  categories: ["MARKETS"],
  refreshIntervalMs: 10 * 60_000,
  timeoutMs: 120_000,
  mode: "live",
  fetch: fetchSecInsider,
  parse: parseSecInsider,
};
