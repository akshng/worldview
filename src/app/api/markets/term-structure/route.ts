import { getTermStructure } from "@/lib/finance/term-structure";
import { handler, json } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** GET /api/markets/term-structure — futures curves (WTI, Brent, natural gas, gold) and the VIX term structure. */
export const GET = handler(async () => json(await getTermStructure()));
