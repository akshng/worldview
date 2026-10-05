import { toEventSummary } from "@/types/events";
import { parseEventQuery } from "@/lib/events/query";
import { dataMode, getRepository } from "@/lib/server/context";
import { badRequest, handler, json } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/**
 * GET /api/events?from=&to=&type=EARTHQUAKE,FIRE&country=JP&importance=40&bbox=w,s,e,n&q=&sort=recent|importance&limit=&offset=
 */
export const GET = handler(async (req: Request) => {
  const parsed = parseEventQuery(new URL(req.url).searchParams);
  if (!parsed.success) return badRequest(parsed.error);
  const repo = await getRepository();
  const { events, total } = await repo.query(parsed.data);
  return json({
    mode: dataMode(),
    total,
    limit: parsed.data.limit,
    offset: parsed.data.offset,
    version: repo.version(),
    generatedAt: new Date().toISOString(),
    events: events.map(toEventSummary),
  });
});
