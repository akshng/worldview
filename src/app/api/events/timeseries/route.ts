import { z } from "zod";
import { bucketCounts } from "@/lib/charts/specs";
import { getRepository } from "@/lib/server/context";
import { badRequest, handler, json } from "@/lib/server/http";
import { EVENT_CATEGORIES } from "@/types/events";

export const dynamic = "force-dynamic";

const Q = z.object({
  type: z.enum(EVENT_CATEGORIES).optional(),
  source: z.string().regex(/^[a-z0-9-]{1,40}$/).optional(),
  country: z.string().regex(/^[A-Z]{2}$/).optional(),
  days: z.coerce.number().int().min(1).max(30).default(7),
});

/** GET /api/events/timeseries?type=&source=&country=&days= — events per day (per hour for ≤ 2 days). */
export const GET = handler(async (req: Request) => {
  const p = Q.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!p.success) return badRequest(p.error);
  const { type, source, country, days } = p.data;
  const now = Date.now();
  const repo = await getRepository();
  const events = (await repo.scan({ from: new Date(now - days * 86_400_000).toISOString(), ...(type ? { type: [type] } : {}) })).filter(
    (e) => (!source || e.sources.some((s) => s.dataSourceId === source)) && (!country || e.country === country) && !e.isSynthetic,
  );
  const bucketMs = days <= 2 ? 3_600_000 : 86_400_000;
  return json({ days, bucket: bucketMs === 3_600_000 ? "hour" : "day", total: events.length, points: bucketCounts(events.map((e) => Date.parse(e.timestamp)), now, days, bucketMs) });
});
