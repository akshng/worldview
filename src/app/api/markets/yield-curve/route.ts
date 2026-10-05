import { getYieldCurve } from "@/lib/finance/service";
import { handler, json } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** GET /api/markets/yield-curve — US Treasury par yield curve, latest vs ~1 month earlier. */
export const GET = handler(async () => json(await getYieldCurve()));
