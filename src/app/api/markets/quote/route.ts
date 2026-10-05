import { z } from "zod";
import { getQuote } from "@/lib/finance/service";
import { SYMBOL_PATTERN } from "@/lib/finance/instruments";
import { badRequest, handler, json } from "@/lib/server/http";

export const dynamic = "force-dynamic";

const Query = z.object({
  symbols: z
    .string()
    .transform((s) => [...new Set(s.split(",").map((x) => x.trim().toUpperCase()).filter(Boolean))])
    .pipe(z.array(z.string().regex(SYMBOL_PATTERN)).min(1).max(25)),
});

/** GET /api/markets/quote?symbols=AAPL,TSLA — quotes for a watchlist (max 25). */
export const GET = handler(async (req: Request) => {
  const parsed = Query.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!parsed.success) return badRequest(parsed.error);
  const quotes = await Promise.all(parsed.data.symbols.map((s) => getQuote(s)));
  return json({ quotes });
});
