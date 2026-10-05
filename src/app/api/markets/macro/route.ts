import { getMacroDashboard } from "@/lib/finance/macro";
import { handler, json } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** GET /api/markets/macro — US macro indicators (FRED) + crypto Fear & Greed. Cached 6 h. */
export const GET = handler(async () => json(await getMacroDashboard()));
