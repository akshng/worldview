import { getMarketSnapshot } from "@/lib/finance/service";
import { handler, json } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** GET /api/markets — indices, rates, FX, commodities, crypto (cached, keyless sources). */
export const GET = handler(async () => json(await getMarketSnapshot()));
