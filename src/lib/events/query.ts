/**
 * Event query model + pure filtering, shared by repositories, API validation and tests.
 */
import { z } from "zod";
import { EVENT_CATEGORIES, EVENT_STATUSES, type WorldEvent } from "@/types/events";
import { bboxContains, isValidBBox, type BBox } from "@/lib/geo/math";

const csv = <T extends z.ZodType<unknown, string>>(item: T) =>
  z
    .string()
    .transform((s) => s.split(",").map((x) => x.trim()).filter(Boolean))
    .pipe(z.array(item));

const isoDate = z
  .string()
  .refine((s) => !Number.isNaN(Date.parse(s)), "Invalid date")
  .transform((s) => new Date(s).toISOString());

export const EventQuerySchema = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  type: csv(z.enum(EVENT_CATEGORIES)).optional(),
  status: csv(z.enum(EVENT_STATUSES)).optional(),
  country: z
    .string()
    .regex(/^([A-Za-z]{2}|X-[A-Za-z0-9]{3})$/, "Use an ISO 3166-1 alpha-2 code")
    .transform((s) => s.toUpperCase())
    .optional(),
  importance: z.coerce.number().int().min(0).max(100).optional(),
  bbox: z
    .string()
    .transform((s) => s.split(",").map(Number))
    .refine((a) => a.length === 4 && isValidBBox(a as BBox), "bbox must be west,south,east,north")
    .transform((a) => a as BBox)
    .optional(),
  q: z.string().trim().max(200).optional(),
  /** Only events reported by one of these connectors (comma-separated ids). */
  source: csv(z.string().regex(/^[a-z0-9-]{1,40}$/)).optional(),
  synthetic: z.enum(["include", "exclude", "only"]).optional(),
  sort: z.enum(["recent", "importance"]).default("recent"),
  limit: z.coerce.number().int().min(1).max(20000).default(500),
  offset: z.coerce.number().int().min(0).default(0),
});
export type EventQuery = z.infer<typeof EventQuerySchema>;
export type EventQueryInput = z.input<typeof EventQuerySchema>;

export function parseEventQuery(params: URLSearchParams | Record<string, string>) {
  const obj = params instanceof URLSearchParams ? Object.fromEntries(params.entries()) : params;
  return EventQuerySchema.safeParse(obj);
}

export function matchesQuery(e: WorldEvent, q: Partial<EventQuery>): boolean {
  const t = Date.parse(e.timestamp);
  if (q.from && t < Date.parse(q.from)) return false;
  if (q.to && t > Date.parse(q.to)) return false;
  if (q.type && q.type.length && !q.type.includes(e.type)) return false;
  if (q.status && q.status.length && !q.status.includes(e.status)) return false;
  if (q.country && e.country !== q.country) return false;
  if (q.source && q.source.length && !e.sources.some((s) => q.source!.includes(s.dataSourceId))) return false;
  if (q.importance !== undefined && e.importanceScore < q.importance) return false;
  if (q.bbox && !bboxContains(q.bbox, e.latitude, e.longitude)) return false;
  if (q.synthetic === "exclude" && e.isSynthetic) return false;
  if (q.synthetic === "only" && !e.isSynthetic) return false;
  if (q.q && !textMatches(e, q.q)) return false;
  return true;
}

/** Lower-cased text that free-text search matches against (also stored by SQL repositories). */
export function searchHaystack(e: WorldEvent): string {
  return [
    e.title,
    e.summary,
    e.locationName,
    e.countryName,
    e.country,
    e.region,
    e.type,
    e.subtype,
    ...e.entities.map((x) => x.name),
    ...e.sources.map((s) => s.sourceName),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function searchTerms(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean);
}

export function textMatches(e: WorldEvent, query: string): boolean {
  const terms = searchTerms(query);
  if (!terms.length) return true;
  const hay = searchHaystack(e);
  return terms.every((t) => hay.includes(t));
}

/**
 * Sort key for "recent": distance from now. A launch scheduled 8 h ahead ranks
 * like an event from 8 h ago, so upcoming items don't crowd the top of the feed.
 */
export function recencyKey(e: Pick<WorldEvent, "timestamp">, now = Date.now()): number {
  const t = Date.parse(e.timestamp);
  return t <= now ? t : now - (t - now);
}

export function sortEvents(events: WorldEvent[], sort: EventQuery["sort"], now = Date.now()): WorldEvent[] {
  return sort === "importance"
    ? events.sort((a, b) => b.importanceScore - a.importanceScore || recencyKey(b, now) - recencyKey(a, now))
    : events.sort((a, b) => recencyKey(b, now) - recencyKey(a, now) || b.importanceScore - a.importanceScore);
}
