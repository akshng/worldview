import { SYMBOL_PATTERN } from "@/lib/finance/instruments";
import { getDividends } from "@/lib/finance/dividends";
import { badRequest, handler, json } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** GET /api/markets/dividends/:symbol — dividend history (5 years), trailing-12-month total and yield. */
export const GET = handler(async (_req: Request, ctx: RouteContext<"/api/markets/dividends/[symbol]">) => {
  const { symbol } = await ctx.params;
  const s = decodeURIComponent(symbol).toUpperCase();
  if (!SYMBOL_PATTERN.test(s)) return badRequest("Invalid symbol");
  return json(await getDividends(s));
});
