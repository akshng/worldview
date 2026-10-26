import { insiderActivity } from "@/lib/finance/insiders-service";
import { ContactMissingError } from "@/lib/finance/thirteenf-service";
import { handler, json, notFound } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** GET /api/markets/insiders/:ticker — open-market insider buys and sells from SEC Form 4 (last 90 days). */
export const GET = handler(async (_req: Request, ctx: RouteContext<"/api/markets/insiders/[ticker]">) => {
  const { ticker } = await ctx.params;
  if (!/^[A-Za-z]{1,5}([-.][A-Za-z])?$/.test(ticker)) return notFound("Not a US stock ticker");
  try {
    const s = await insiderActivity(ticker);
    return s ? json(s) : notFound("No SEC filer for this ticker");
  } catch (e) {
    if (e instanceof ContactMissingError) return json({ error: e.message }, { status: 503 });
    throw e;
  }
});
