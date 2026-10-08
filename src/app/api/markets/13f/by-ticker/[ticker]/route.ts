import { SYMBOL_PATTERN } from "@/lib/finance/instruments";
import { ContactMissingError, holdersOf } from "@/lib/finance/thirteenf-service";
import { badRequest, handler, json } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** GET /api/markets/13f/by-ticker/:ticker — tracked managers whose latest 13F holds this stock (ticker matched by company name). */
export const GET = handler(async (_req: Request, ctx: RouteContext<"/api/markets/13f/by-ticker/[ticker]">) => {
  const { ticker } = await ctx.params;
  const t = decodeURIComponent(ticker).toUpperCase();
  if (!SYMBOL_PATTERN.test(t)) return badRequest("Invalid symbol");
  try {
    return json(await holdersOf(t));
  } catch (err) {
    if (err instanceof ContactMissingError) return json({ error: err.message }, { status: 503 });
    throw err;
  }
});
