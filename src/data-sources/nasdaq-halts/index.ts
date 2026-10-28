/**
 * U.S. equity trading halts from Nasdaq Trader's public halts RSS (keyless): news-pending,
 * regulatory, SEC-suspension and market-wide circuit-breaker halts with their reason code.
 * Routine 5-minute limit-up/limit-down volatility pauses are skipped (counted). Halt and
 * resumption times in the feed are U.S. Eastern wall-clock times; they are converted to UTC.
 * Placed at the listing exchange in New York.
 */
import type { EventCandidateInput } from "@/types/events";
import { decodeXmlText } from "../news-rss/client";
import { httpGet, plainText, type DataSourceConnector, type FetchContext, type ParseContext, type ParseResult } from "../types";
import { HQ, clip, makeSource, zonedToUtc } from "../official-common";

export interface NasdaqHalt {
  symbol: string;
  name: string;
  market: string;
  reasonCode: string;
  haltDate: string; // MM/DD/YYYY
  haltTime: string; // HH:MM:SS(.mmm)
  resumptionDate: string | null;
  resumptionTradeTime: string | null;
}
export interface NasdaqHaltsRaw {
  halts: NasdaqHalt[];
}

const FEED = "https://www.nasdaqtrader.com/rss.aspx?feed=tradehalts";
const PAGE = "https://www.nasdaqtrader.com/trader.aspx?id=TradeHalts";
/** Resumed halts older than this are history; halts still in force are kept up to MAX_OPEN_AGE. */
const MAX_AGE_MS = 3 * 86_400_000;
const MAX_OPEN_AGE_MS = 14 * 86_400_000;

/** Nasdaq halt reason codes (nasdaqtrader.com "Trading Halt Codes"). */
export const HALT_REASONS: Record<string, string> = {
  T1: "news pending",
  T2: "news released",
  T3: "news and resumption times",
  T5: "single-stock trading pause",
  T6: "extraordinary market activity",
  T7: "quotation-only period",
  T8: "ETF halt",
  T12: "additional information requested by Nasdaq",
  H4: "non-compliance with listing requirements",
  H9: "not current in required filings",
  H10: "SEC trading suspension",
  H11: "regulatory concern",
  O1: "operations halt",
  IPO1: "IPO issue not yet trading",
  M1: "corporate action",
  M2: "quotation not available",
  MWC1: "market-wide circuit breaker, level 1",
  MWC2: "market-wide circuit breaker, level 2",
  MWC3: "market-wide circuit breaker, level 3",
  MWC0: "market-wide circuit breaker halt carried over",
  MWCQ: "market-wide circuit breaker resumption",
  R4: "qualification issues reviewed / resolved",
  R9: "filing requirements satisfied / resolved",
  C3: "issuer news not forthcoming",
  C4: "qualifications halt ended",
  C9: "qualifications halt concluded",
  C11: "trade halt concluded by another regulator",
  D: "security deletion",
};
/** Automatic limit-up/limit-down pauses (a few minutes each, dozens a day). */
const ROUTINE = new Set(["LUDP", "LUDS", "M"]);
const REGULATORY = /^(H|C)\d|^T12$|^R\d/;

const field = (b: string, n: string) => {
  const m = b.match(new RegExp(`<ndaq:${n}(?:\\s[^>]*)?>([\\s\\S]*?)</ndaq:${n}>`, "i"));
  const v = m ? decodeXmlText(m[1]).trim() : "";
  return v || null;
};

/** Read the feed's `ndaq:` item fields (the generic RSS reader drops them). */
export function readHaltsXml(xml: string): NasdaqHalt[] {
  const out: NasdaqHalt[] = [];
  for (const b of xml.match(/<item(?:\s[^>]*)?>[\s\S]*?<\/item>/gi) ?? []) {
    const symbol = field(b, "IssueSymbol");
    const haltDate = field(b, "HaltDate");
    const haltTime = field(b, "HaltTime");
    if (!symbol || !haltDate || !haltTime) continue;
    out.push({
      symbol,
      name: field(b, "IssueName") ?? symbol,
      market: field(b, "Market") ?? "",
      reasonCode: field(b, "ReasonCode") ?? "",
      haltDate,
      haltTime,
      resumptionDate: field(b, "ResumptionDate"),
      resumptionTradeTime: field(b, "ResumptionTradeTime"),
    });
  }
  return out;
}

export async function fetchNasdaqHalts(ctx: FetchContext): Promise<NasdaqHaltsRaw> {
  const res = await httpGet(FEED, ctx, { accept: "application/rss+xml, application/xml, text/xml" });
  return { halts: readHaltsXml(await res.text()) };
}

/** "10/28/2026" + "15:55:01.816" (US Eastern) → UTC ISO string. */
export function easternStamp(date: string | null, time: string | null): string | null {
  const d = date?.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  const t = time?.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!d || !t) return null;
  return zonedToUtc("America/New_York", +d[3], +d[1], +d[2], +t[1], +t[2], +(t[3] ?? 0)).toISOString();
}

export function parseNasdaqHalts(raw: NasdaqHaltsRaw, ctx: ParseContext): ParseResult {
  const candidates: EventCandidateInput[] = [];
  let skipped = 0;
  const seen = new Set<string>();
  for (const h of raw.halts ?? []) {
    const code = h.reasonCode.toUpperCase();
    const ts = easternStamp(h.haltDate, h.haltTime);
    const resumed = easternStamp(h.resumptionDate, h.resumptionTradeTime);
    const age = ts ? ctx.now - Date.parse(ts) : NaN;
    if (!ts || ROUTINE.has(code) || Number.isNaN(age) || age > (resumed ? MAX_AGE_MS : MAX_OPEN_AGE_MS) || age < -3_600_000) {
      skipped++;
      continue;
    }
    const symbol = plainText(h.symbol, 12).toUpperCase();
    const externalId = `${symbol}:${ts}`;
    if (seen.has(externalId)) {
      skipped++;
      continue;
    }
    seen.add(externalId);
    const name = plainText(h.name, 120);
    const reason = HALT_REASONS[code] ?? (code ? `reason code ${code}` : "reason not given");
    const nyse = /^(AMEX|NYSE)/i.test(h.market);
    const place = nyse ? HQ.nyse : HQ.nasdaq;
    const market = /^AMEX$/i.test(h.market) ? "NYSE American" : h.market || "U.S.";
    const title = clip(`Trading halt: ${name} (${symbol}) — ${reason}`);
    const resumedFuture = resumed && Date.parse(resumed) > ctx.now;
    candidates.push({
      type: "MARKETS",
      subtype: code.startsWith("MWC") ? "circuit breaker" : REGULATORY.test(code) ? "regulatory halt" : "trading halt",
      title,
      summary:
        `Nasdaq Trader halt list: trading in ${name} (${symbol}, ${market}) was halted at ${h.haltTime.slice(0, 8)} ET on ${h.haltDate} — reason code ${code || "none"} (${reason}). ` +
        (resumed ? `Trading ${resumedFuture ? "is scheduled to resume" : "resumed"} at ${h.resumptionTradeTime} ET on ${h.resumptionDate}.` : "No resumption time has been published."),
      latitude: place.lat,
      longitude: place.lon,
      geoPrecision: "city",
      locationName: place.name,
      country: "US",
      timestamp: ts,
      resolvedAt: resumed && !resumedFuture ? resumed : null,
      metrics: { symbol, reason_code: code || null, market, resumed: Boolean(resumed && !resumedFuture) },
      entities: [{ type: "ORGANIZATION", name, code: symbol }],
      source: makeSource({
        dataSourceId: "nasdaq-halts",
        externalId,
        sourceName: "Nasdaq Trader — trading halts",
        sourceUrl: PAGE,
        title,
        publishedAt: ts,
        retrievedAt: ctx.retrievedAt,
        basis: "Nasdaq (national securities exchange) official halt list; filed as an official source for lack of an exchange source type",
      }),
      rawData: h,
    });
  }
  return { candidates, skipped };
}

export const nasdaqHaltsConnector: DataSourceConnector<NasdaqHaltsRaw> = {
  id: "nasdaq-halts",
  name: "U.S. trading halts",
  description: "Stock trading halts (news pending, regulatory, SEC suspension, circuit breakers) from Nasdaq Trader; LULD volatility pauses skipped.",
  homepage: PAGE,
  attribution: "Nasdaq Trader trading halts RSS — © Nasdaq, Inc.; link back to nasdaqtrader.com",
  sourceType: "OFFICIAL_AGENCY",
  categories: ["MARKETS"],
  refreshIntervalMs: 5 * 60_000,
  mode: "live",
  fetch: fetchNasdaqHalts,
  parse: parseNasdaqHalts,
};
