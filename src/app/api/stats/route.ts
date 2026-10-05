import { parseEventQuery } from "@/lib/events/query";
import { dataMode, getRepository } from "@/lib/server/context";
import { computeStats } from "@/lib/events/stats";
import { badRequest, handler, json } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** GET /api/stats — aggregate counts for the same filters as /api/events. */
export const GET = handler(async (req: Request) => {
  const parsed = parseEventQuery(new URL(req.url).searchParams);
  if (!parsed.success) return badRequest(parsed.error);
  const repo = await getRepository();
  const events = await repo.scan(parsed.data);
  return json({ mode: dataMode(), version: repo.version(), window: { from: parsed.data.from ?? null, to: parsed.data.to ?? null }, stats: computeStats(events) });
});
