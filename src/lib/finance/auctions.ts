/** Recent U.S. Treasury auction results (Fiscal Data API, keyless). Cached 6 hours. */
import "server-only";
import { userAgent } from "@/lib/env";

export interface AuctionResult {
  date: string;
  security: string;
  term: string;
  /** High yield (notes/bonds) or high investment rate (bills), % */
  rate: number | null;
  bidToCover: number | null;
  /** Share of the accepted amount taken by indirect bidders (often a proxy for foreign demand) */
  indirectPct: number | null;
  dealerPct: number | null;
  accepted: number | null;
}

type Raw = Record<string, string | null>;
const num = (v: string | null | undefined) => (v && v !== "null" && Number.isFinite(Number(v)) ? Number(v) : null);

export function parseAuctions(rows: Raw[]): AuctionResult[] {
  return rows
    .filter((r) => num(r.total_accepted) && (num(r.high_yield) !== null || num(r.high_investment_rate) !== null))
    .map((r) => {
      const total = num(r.total_accepted)!;
      const pct = (v: string | null) => (num(v) !== null ? Math.round((num(v)! / total) * 1000) / 10 : null);
      return {
        date: String(r.auction_date),
        security: String(r.security_type),
        term: String(r.security_term),
        rate: num(r.high_yield) ?? num(r.high_investment_rate),
        bidToCover: num(r.bid_to_cover_ratio),
        indirectPct: pct(r.indirect_bidder_accepted),
        dealerPct: pct(r.primary_dealer_accepted),
        accepted: total,
      };
    });
}

const g = globalThis as unknown as { __worldviewAuctions?: { at: number; value: AuctionResult[] } };

export async function getRecentAuctions(): Promise<AuctionResult[]> {
  const hit = g.__worldviewAuctions;
  if (hit && Date.now() - hit.at < 6 * 3_600_000) return hit.value;
  const fields = "auction_date,security_type,security_term,high_yield,high_investment_rate,bid_to_cover_ratio,indirect_bidder_accepted,primary_dealer_accepted,total_accepted";
  const res = await fetch(
    `https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/od/auctions_query?sort=-auction_date&page%5Bsize%5D=60&fields=${fields}&filter=auction_date:lte:${new Date().toISOString().slice(0, 10)}`,
    { headers: { "User-Agent": userAgent(), Accept: "application/json" }, signal: AbortSignal.timeout(30_000), cache: "no-store" },
  );
  if (!res.ok) {
    if (hit) return hit.value;
    throw new Error(`HTTP ${res.status}`);
  }
  const value = parseAuctions(((await res.json()) as { data?: Raw[] }).data ?? []).slice(0, 16);
  g.__worldviewAuctions = { at: Date.now(), value };
  return value;
}
