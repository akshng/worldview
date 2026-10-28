/**
 * U.S. Treasury marketable-securities auction RESULTS from TreasuryDirect's public securities
 * web service (keyless JSON; `TA_WS/securities/auctioned`). One event per auctioned CUSIP and
 * auction date: high rate / yield / discount margin, bid-to-cover and the indirect-bidder share
 * of competitive awards — numbers exactly as published, never estimated. Auctions without
 * results yet are skipped. Timestamps are when TreasuryDirect posted the results (US Eastern
 * → UTC). Placed at the Treasury in Washington.
 */
import type { EventCandidateInput } from "@/types/events";
import { httpGet, plainText, type DataSourceConnector, type FetchContext, type ParseContext, type ParseResult } from "../types";
import { HQ, clip, makeSource, zonedToUtc } from "../official-common";

export interface TreasuryAuction {
  cusip: string;
  securityType: string;
  securityTerm: string;
  auctionDate?: string;
  competitiveAuctionCloseDate?: string;
  competitiveAuctionCloseTime?: string;
  updatedTimestamp?: string;
  highYield?: string;
  highRate?: string;
  highDiscountMargin?: string;
  investmentRate?: string;
  interestRate?: string;
  bidToCoverRatio?: string;
  offeringAmount?: string;
  totalAccepted?: string;
  totalParAwardedInsideOfOfferingAmount?: string;
  indirectBiddersCompetitiveParAwarded?: string;
  directBiddersCompetitiveParAwarded?: string;
  primaryDealersCompetitiveParAwarded?: string;
  subtotalCompetitiveParAwardedInsideOfOfferingAmount?: string;
  reopening?: string;
  inflationProtected?: string;
  floatingRate?: string;
  cashManagementBill?: string;
  treasuryAuctionResultsPressReleaseFileName?: string;
}
export type TreasuryAuctionsRaw = TreasuryAuction[];

const API = "https://www.treasurydirect.gov/TA_WS/securities/auctioned?format=json&days=7";
const MAX_AGE_MS = 7 * 86_400_000;

export async function fetchTreasuryAuctions(ctx: FetchContext): Promise<TreasuryAuctionsRaw> {
  const j = (await (await httpGet(API, ctx)).json()) as unknown;
  return Array.isArray(j) ? (j as TreasuryAuctionsRaw) : [];
}

const n = (s: string | undefined) => (s && s.trim() !== "" && Number.isFinite(Number(s)) ? Number(s) : null);
const yes = (s: string | undefined) => /^yes$/i.test(s ?? "");

/** "2026-10-28T11:33:48" (US Eastern, no zone) → ISO UTC. */
export function easternIso(s: string | undefined): string | null {
  const m = s?.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/);
  return m ? zonedToUtc("America/New_York", +m[1], +m[2], +m[3], +m[4], +m[5], +(m[6] ?? 0)).toISOString() : null;
}

const bn = (x: number) => (x >= 1e9 ? `$${(x / 1e9).toFixed(x >= 1e10 ? 0 : 1)}B` : `$${(x / 1e6).toFixed(0)}M`);

export function securityLabel(a: TreasuryAuction): string {
  const kind = yes(a.inflationProtected) ? "TIPS" : yes(a.floatingRate) ? "FRN" : a.securityType;
  const cmb = yes(a.cashManagementBill) ? " cash management" : "";
  return `${plainText(a.securityTerm, 40)}${cmb} ${kind}${yes(a.reopening) ? " (reopening)" : ""}`;
}

export function parseTreasuryAuctions(raw: TreasuryAuctionsRaw, ctx: ParseContext): ParseResult {
  const candidates: EventCandidateInput[] = [];
  let skipped = 0;
  const seen = new Set<string>();
  for (const a of raw ?? []) {
    const date = (a.auctionDate || a.competitiveAuctionCloseDate || "").slice(0, 10);
    const btc = n(a.bidToCoverRatio);
    const isFrn = yes(a.floatingRate);
    const isBill = /^bill$/i.test(a.securityType);
    const level = isFrn ? n(a.highDiscountMargin) : isBill ? n(a.highRate) : n(a.highYield);
    const posted = easternIso(a.updatedTimestamp);
    const ts = posted ?? (date ? zonedToUtc("America/New_York", +date.slice(0, 4), +date.slice(5, 7), +date.slice(8, 10), 13, 0).toISOString() : null);
    const key = `${a.cusip}:${date}`;
    if (!a.cusip || !/^\d{4}-\d{2}-\d{2}$/.test(date) || level == null || btc == null || !ts || ctx.now - Date.parse(ts) > MAX_AGE_MS || seen.has(key)) {
      skipped++;
      continue;
    }
    seen.add(key);
    const label = securityLabel(a);
    const measure = isFrn ? "high discount margin" : isBill ? "high rate" : "high yield";
    const levelText = `${level.toFixed(3)}%`;
    const awarded = n(a.totalParAwardedInsideOfOfferingAmount) ?? n(a.offeringAmount);
    const comp = n(a.subtotalCompetitiveParAwardedInsideOfOfferingAmount);
    const indirect = n(a.indirectBiddersCompetitiveParAwarded);
    const indirectPct = comp && indirect != null ? Math.round((indirect / comp) * 1000) / 10 : null;
    const title = clip(`Treasury auction: ${label} — ${measure} ${levelText}, bid-to-cover ${btc.toFixed(2)}`);
    const pdf = a.treasuryAuctionResultsPressReleaseFileName?.match(/^[\w.-]+\.pdf$/) ? a.treasuryAuctionResultsPressReleaseFileName : null;
    candidates.push({
      type: "MARKETS",
      subtype: "treasury auction",
      title,
      summary:
        `U.S. Treasury auction of ${date} (CUSIP ${a.cusip}): ${label}, ${measure} ${levelText}` +
        `${isBill && n(a.investmentRate) != null ? ` (investment rate ${n(a.investmentRate)!.toFixed(3)}%)` : ""}, bid-to-cover ${btc.toFixed(2)}` +
        `${awarded ? `, ${bn(awarded)} awarded` : ""}${indirectPct != null ? `; indirect bidders took ${indirectPct}% of competitive awards` : ""}. Results as published by TreasuryDirect.`,
      latitude: HQ.treasury.lat,
      longitude: HQ.treasury.lon,
      geoPrecision: "city",
      locationName: HQ.treasury.name,
      country: HQ.treasury.country,
      timestamp: ts,
      metrics: {
        cusip: a.cusip,
        security: label,
        [isFrn ? "high_discount_margin_pct" : isBill ? "high_rate_pct" : "high_yield_pct"]: level,
        bid_to_cover: btc,
        awarded_usd: awarded,
        indirect_pct: indirectPct,
        auction_date: date,
      },
      entities: [{ type: "ORGANIZATION", name: "U.S. Department of the Treasury", code: "UST" }],
      source: makeSource({
        dataSourceId: "treasury-auctions",
        externalId: key,
        sourceName: "TreasuryDirect — auction results",
        sourceUrl: pdf ? `https://www.treasurydirect.gov/instit/annceresult/press/preanre/${date.slice(0, 4)}/${pdf}` : "https://www.treasurydirect.gov/auctions/auction-query/",
        title,
        publishedAt: ts,
        retrievedAt: ctx.retrievedAt,
        basis: "U.S. Treasury, Bureau of the Fiscal Service (TreasuryDirect) official auction results",
      }),
      rawData: { cusip: a.cusip, date, updated: a.updatedTimestamp, type: a.securityType, term: a.securityTerm },
    });
  }
  return { candidates, skipped };
}

export const treasuryAuctionsConnector: DataSourceConnector<TreasuryAuctionsRaw> = {
  id: "treasury-auctions",
  name: "Treasury auction results",
  description: "U.S. Treasury bill, note, bond, TIPS and FRN auction results (high rate/yield, bid-to-cover, indirect share) from TreasuryDirect, last 7 days.",
  homepage: "https://www.treasurydirect.gov/auctions/announcements-data-results/",
  attribution: "U.S. Department of the Treasury, Bureau of the Fiscal Service (TreasuryDirect) — public domain",
  sourceType: "OFFICIAL_AGENCY",
  categories: ["MARKETS"],
  refreshIntervalMs: 15 * 60_000,
  mode: "live",
  fetch: fetchTreasuryAuctions,
  parse: parseTreasuryAuctions,
};
