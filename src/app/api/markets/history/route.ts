import { z } from "zod";
import { SYMBOL_PATTERN } from "@/lib/finance/instruments";
import { getHistory } from "@/lib/finance/service";
import { badRequest, handler, json } from "@/lib/server/http";

export const dynamic = "force-dynamic";

const Range = z.enum(["1mo", "6mo", "1y", "5y"]).default("6mo");

/** GET /api/markets/history?symbol=&range= — price history only (light, for charts). */
export const GET = handler(async (req: Request) => {
  const q = new URL(req.url).searchParams;
  const symbol = (q.get("symbol") ?? "").toUpperCase();
  if (!SYMBOL_PATTERN.test(symbol)) return badRequest("Invalid symbol");
  const range = Range.safeParse(q.get("range") ?? undefined);
  if (!range.success) return badRequest(range.error);
  const h = await getHistory(symbol, range.data);
  return json({ symbol, name: h.name, currency: h.currency, points: h.points });
});
