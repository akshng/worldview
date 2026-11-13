import { SYMBOL_PATTERN } from "@/lib/finance/instruments";
import { getShortVolume } from "@/lib/finance/short-volume";
import { badRequest, decodeParam, handler, json } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** GET /api/markets/short-volume/:symbol — FINRA daily short sale volume, last 10 sessions. */
export const GET = handler(async (_req: Request, ctx: RouteContext<"/api/markets/short-volume/[symbol]">) => {
  const { symbol } = await ctx.params;
  const s = decodeParam(symbol)?.toUpperCase();
  if (!s || !SYMBOL_PATTERN.test(s)) return badRequest("Invalid symbol");
  return json(await getShortVolume(s));
});
