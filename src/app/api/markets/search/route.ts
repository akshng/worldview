import { z } from "zod";
import { searchInstruments } from "@/lib/finance/search";
import { badRequest, handler, json } from "@/lib/server/http";

export const dynamic = "force-dynamic";

const Query = z.object({ q: z.string().trim().min(1).max(40) });

/** GET /api/markets/search?q= — find any stock, ETF, index, future, currency or crypto worldwide. */
export const GET = handler(async (req: Request) => {
  const parsed = Query.safeParse({ q: new URL(req.url).searchParams.get("q") ?? "" });
  if (!parsed.success) return badRequest(parsed.error);
  return json({ hits: await searchInstruments(parsed.data.q), source: "Yahoo Finance search (unofficial)" });
});
