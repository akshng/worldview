import { getRepository } from "@/lib/server/context";
import { relatedEvents } from "@/lib/server/analytics";
import { marketExposure } from "@/lib/finance/exposure";
import { handler, json, notFound } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** GET /api/events/:id[?raw=1] — full event with sources, timeline and related events. */
export const GET = handler(async (req: Request, ctx: RouteContext<"/api/events/[id]">) => {
  const { id } = await ctx.params;
  if (!/^[\w-]{1,80}$/.test(id)) return notFound("Event not found");
  const repo = await getRepository();
  const event = await repo.get(id);
  if (!event) return notFound("Event not found");
  const includeRaw = new URL(req.url).searchParams.get("raw") === "1";
  const related = await relatedEvents(repo, event);
  return json({ event: includeRaw ? event : { ...event, rawData: {} }, related, marketExposure: event.isSynthetic ? [] : marketExposure(event) });
});
