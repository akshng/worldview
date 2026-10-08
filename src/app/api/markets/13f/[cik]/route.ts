import { ContactMissingError, isTracked, managerHoldings } from "@/lib/finance/thirteenf-service";
import { badRequest, handler, json, notFound } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/**
 * GET /api/markets/13f/:cik?limit=250 — a tracked manager's latest 13F holdings
 * (largest first) with portfolio weight and quarter-over-quarter change.
 */
export const GET = handler(async (req: Request, ctx: RouteContext<"/api/markets/13f/[cik]">) => {
  const { cik } = await ctx.params;
  if (!/^\d{1,10}$/.test(cik)) return badRequest("Invalid CIK");
  if (!isTracked(cik)) return notFound("Not a tracked manager");
  const raw = Number(new URL(req.url).searchParams.get("limit") ?? 250);
  const limit = Number.isFinite(raw) ? Math.min(10_000, Math.max(1, Math.floor(raw))) : 250;
  try {
    const data = await managerHoldings(cik, limit);
    return data ? json(data) : notFound("No 13F holdings report found for this manager");
  } catch (err) {
    if (err instanceof ContactMissingError) return json({ error: err.message }, { status: 503 });
    return json({ error: `SEC data unavailable: ${(err as Error).message}` }, { status: 502 });
  }
});
