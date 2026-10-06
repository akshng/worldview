import { getRecentAuctions } from "@/lib/finance/auctions";
import { handler, json } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** GET /api/markets/auctions — recent U.S. Treasury auction results. */
export const GET = handler(async () => json({ auctions: await getRecentAuctions(), source: "U.S. Treasury Fiscal Data — Treasury Securities Auctions Data" }));
