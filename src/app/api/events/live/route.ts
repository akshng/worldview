import { toEventSummary } from "@/types/events";
import { parseEventQuery } from "@/lib/events/query";
import { dataMode, getRepository } from "@/lib/server/context";
import { badRequest, handler, json } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** GET /api/events/live — events from the last 60 minutes (other filters still apply). */
export const GET = handler(async (req: Request) => {
  const params = new URL(req.url).searchParams;
  params.set("from", new Date(Date.now() - 60 * 60_000).toISOString());
  const parsed = parseEventQuery(params);
  if (!parsed.success) return badRequest(parsed.error);
  const repo = await getRepository();
  const { events, total } = await repo.query(parsed.data);
  return json({ mode: dataMode(), total, version: repo.version(), events: events.map(toEventSummary) });
});
