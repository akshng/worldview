import { getRegistrations } from "@/lib/finance/ipos";
import { handler, json } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** GET /api/markets/ipos — S-1/F-1 registration statements filed in the last 30 days (SEC EDGAR). */
export const GET = handler(async () => json({ filings: await getRegistrations(), source: "SEC EDGAR full-text search" }));
