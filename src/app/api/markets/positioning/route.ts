import { getCot } from "@/lib/finance/cot";
import { handler, json } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** GET /api/markets/positioning — speculators' net futures positions (CFTC COT, weekly). */
export const GET = handler(async () => json(await getCot()));
