import { getScreener, SCREENERS, type ScreenerList } from "@/lib/finance/screeners";
import { badRequest, handler, json } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** GET /api/markets/screener?list=gainers|losers|active — today's US stock movers (delayed). */
export const GET = handler(async (req: Request) => {
  const list = (new URL(req.url).searchParams.get("list") ?? "gainers") as ScreenerList;
  if (!(list in SCREENERS)) return badRequest(`list must be one of ${Object.keys(SCREENERS).join(", ")}`);
  return json(await getScreener(list));
});
