import { z } from "zod";
import { changeSince } from "@/lib/finance/service";
import { SYMBOL_PATTERN } from "@/lib/finance/instruments";
import { badRequest, handler, json } from "@/lib/server/http";

export const dynamic = "force-dynamic";

const Query = z.object({
  symbols: z.string().transform((s) => s.split(",").map((x) => x.trim().toUpperCase()).filter(Boolean)).pipe(z.array(z.string().regex(SYMBOL_PATTERN)).min(1).max(8)),
  since: z.string().refine((s) => !Number.isNaN(Date.parse(s))),
});

/** GET /api/markets/reaction?symbols=BZ=F,CL=F&since=ISO — move of each instrument since a time (≤5 trading days). */
export const GET = handler(async (req: Request) => {
  const parsed = Query.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!parsed.success) return badRequest(parsed.error);
  const since = Date.parse(parsed.data.since);
  const results = await Promise.all(parsed.data.symbols.map((s) => changeSince(s, since)));
  return json({ since: new Date(since).toISOString(), results, note: "Price change measured since the event time. Co-movement is not evidence of cause." });
});
