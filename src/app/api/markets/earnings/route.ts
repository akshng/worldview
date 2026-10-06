import { getEarningsReleases } from "@/lib/finance/earnings";
import { handler, json } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** GET /api/markets/earnings — 8-K Item 2.02 (results of operations) filings from the last 7 days (SEC EDGAR). */
export const GET = handler(async () => json(await getEarningsReleases()));
