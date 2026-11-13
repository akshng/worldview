/**
 * Store caps for events. Syndicated stories collect hundreds of copies; the store
 * keeps a representative set and counts the rest:
 *
 *  - sources: the primary, the first report, the latest report, then the most
 *    authoritative and distinct publishers, up to MAX_SOURCES. Dropped records are
 *    counted in `sourcesOmitted` (so `sourceCount` stays the true total) and their ids
 *    and URLs are remembered as short hashes so they are never re-attached.
 *  - outlets: distinct publishers are kept in `publisherKeys` → `outletCount`, which
 *    also drives corroboration scoring after trimming.
 *  - timeline: the first entry, recent key entries (updates, confirmations, end) and
 *    the latest entries, up to MAX_TIMELINE; the rest counted in `timelineOmitted`.
 *  - rawData: only for listed sources, at most MAX_RAW_ENTRIES, each size-capped.
 *
 * All functions are pure and idempotent.
 */
import type { EventSource, SourceAssertion, TimelineEntry, WorldEvent } from "@/types/events";
import { publisherKey } from "./status";

export const MAX_SOURCES = 12;
export const MAX_TIMELINE = 20;
export const MAX_RAW_ENTRIES = 2;
export const MAX_RAW_CHARS = 600;
export const MAX_PUBLISHER_KEYS = 300;
export const MAX_SEEN_KEYS = 1500;

const AUTHORITY: Record<SourceAssertion, number> = {
  OFFICIAL_FINAL: 6,
  OFFICIAL_PRELIMINARY: 5,
  MEASUREMENT: 4,
  SCHEDULED: 3,
  MEDIA_REPORT: 2,
  SYNTHETIC: 0,
};

export function authorityOf(s: EventSource): number {
  return AUTHORITY[s.assertion];
}

/** FNV-1a 32-bit, base36 (≤ 7 chars). */
export function shortHash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

export function sourceKeys(s: Pick<EventSource, "id" | "sourceUrl">): string[] {
  return s.sourceUrl ? [shortHash(s.id), shortHash(`u:${s.sourceUrl}`)] : [shortHash(s.id)];
}

/** True when this source record (or its URL) was attached before and trimmed/replaced. */
export function wasSeen(e: Pick<WorldEvent, "seenSourceKeys">, s: Pick<EventSource, "id" | "sourceUrl">): boolean {
  const seen = e.seenSourceKeys;
  if (!seen?.length) return false;
  return sourceKeys(s).some((k) => seen.includes(k));
}

const sourceTime = (s: EventSource) => Date.parse(s.publishedAt ?? s.retrievedAt) || 0;

/** Representative sources, primary (index 0) first, original order preserved. */
export function selectSources(sources: EventSource[], max = MAX_SOURCES): EventSource[] {
  if (sources.length <= max) return sources;
  let first = 0, last = 0;
  sources.forEach((s, i) => {
    if (sourceTime(s) < sourceTime(sources[first])) first = i;
    if (sourceTime(s) >= sourceTime(sources[last])) last = i;
  });
  const keep = new Set<number>([0, first, last]);
  const pubs = new Set([...keep].map((i) => publisherKey(sources[i])));
  const rest = sources
    .map((s, i) => ({ s, i }))
    .filter(({ i }) => !keep.has(i))
    .sort((a, b) => authorityOf(b.s) - authorityOf(a.s) || sourceTime(b.s) - sourceTime(a.s));
  // Distinct publishers first (they are the corroboration), then whatever is most authoritative/recent.
  for (const { s, i } of rest) {
    if (keep.size >= max) break;
    const k = publisherKey(s);
    if (!pubs.has(k)) {
      keep.add(i);
      pubs.add(k);
    }
  }
  for (const { i } of rest) {
    if (keep.size >= max) break;
    keep.add(i);
  }
  return sources.filter((_, i) => keep.has(i));
}

const NEWS_TYPES = new Set<EventSource["sourceType"]>(["NEWS_MEDIA", "NEWS_AGGREGATOR"]);

const KEY_KINDS = new Set<TimelineEntry["kind"]>(["OFFICIAL_CONFIRMATION", "RESOLVED", "UPDATE"]);

/** First entry, up to 6 latest key entries, then the latest entries; chronological order kept. */
export function selectTimeline(timeline: TimelineEntry[], max = MAX_TIMELINE): TimelineEntry[] {
  if (timeline.length <= max) return timeline;
  const keep = new Set<number>([0]);
  for (let i = timeline.length - 1, n = 0; i > 0 && n < 6; i--) {
    if (KEY_KINDS.has(timeline[i].kind)) {
      keep.add(i);
      n++;
    }
  }
  for (let i = timeline.length - 1; i > 0 && keep.size < max; i--) keep.add(i);
  return timeline.filter((_, i) => keep.has(i));
}

function shrink(v: unknown, depth: number): unknown {
  if (typeof v === "string") return v.length > 200 ? `${v.slice(0, 200)}…` : v;
  if (Array.isArray(v)) return depth > 3 ? `[${v.length} items]` : v.slice(0, 5).map((x) => shrink(x, depth + 1));
  if (v && typeof v === "object") {
    if (depth > 3) return "{…}";
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v).slice(0, 30)) out[k] = shrink(x, depth + 1);
    return out;
  }
  return v;
}

/** Raw upstream record capped at about MAX_RAW_CHARS of JSON. */
export function capRaw(v: unknown): unknown {
  const s = JSON.stringify(v);
  if (s === undefined || s.length <= MAX_RAW_CHARS) return v;
  const shrunk = shrink(v, 0);
  if ((JSON.stringify(shrunk)?.length ?? 0) <= MAX_RAW_CHARS) return shrunk;
  return { truncated: true, preview: s.slice(0, MAX_RAW_CHARS - 60) };
}

/** Enforce the store caps and maintain the derived counts. Does not rescore. */
export function trimEvent(e: WorldEvent): WorldEvent {
  const pubs = new Set(e.publisherKeys ?? []);
  for (const s of e.sources) pubs.add(publisherKey(s));
  const outletCount = Math.max(e.outletCount ?? 0, pubs.size, e.sources.length ? 1 : 0);

  const sources = selectSources(e.sources);
  let seenSourceKeys = e.seenSourceKeys;
  let sourcesOmitted = e.sourcesOmitted ?? 0;
  if (sources.length < e.sources.length) {
    const kept = new Set(sources);
    const dropped = e.sources.filter((s) => !kept.has(s));
    sourcesOmitted += dropped.length;
    seenSourceKeys = [...new Set([...(seenSourceKeys ?? []), ...dropped.flatMap(sourceKeys)])].slice(-MAX_SEEN_KEYS);
  }

  const timeline = selectTimeline(e.timeline);
  const timelineOmitted = (e.timelineOmitted ?? 0) + (e.timeline.length - timeline.length);

  // Raw records: primary first, then the most recent listed sources. News records are not
  // kept: their raw form only repeats the source fields (link, outlet, time) and themes in metrics.
  const rawIds = [sources[0], ...sources.slice(1).sort((a, b) => sourceTime(b) - sourceTime(a))]
    .filter((s): s is EventSource => !!s && s.id in e.rawData && !NEWS_TYPES.has(s.sourceType))
    .slice(0, MAX_RAW_ENTRIES)
    .map((s) => s.id);
  const rawData: Record<string, unknown> = {};
  for (const id of rawIds) rawData[id] = capRaw(e.rawData[id]);

  const out: WorldEvent = { ...e, sources, timeline, rawData, outletCount, seriesKey: e.seriesKey ?? null };
  // Bookkeeping fields are stored only when they carry information beyond the listed sources.
  delete out.publisherKeys;
  delete out.sourcesOmitted;
  delete out.timelineOmitted;
  delete out.seenSourceKeys;
  if (pubs.size > new Set(sources.map(publisherKey)).size) out.publisherKeys = [...pubs].slice(0, MAX_PUBLISHER_KEYS);
  if (sourcesOmitted) out.sourcesOmitted = sourcesOmitted;
  if (timelineOmitted) out.timelineOmitted = timelineOmitted;
  if (seenSourceKeys?.length) out.seenSourceKeys = seenSourceKeys;
  return out;
}

/** Latest activity used for retention: when it happened, or the last distinct new evidence. */
export function retentionTime(e: Pick<WorldEvent, "timestamp" | "updatedAt" | "lastEvidenceAt">): number {
  return Math.max(Date.parse(e.timestamp), Date.parse(e.lastEvidenceAt ?? e.updatedAt));
}

/**
 * Events stored before these fields existed: derive `lastEvidenceAt` from when each
 * publisher first appeared and from update/confirmation/end entries (never later than
 * `updatedAt`), then trim.
 */
export function migrateLegacyEvent(e: WorldEvent): WorldEvent {
  if (e.lastEvidenceAt) return trimEvent(e);
  const upd = Date.parse(e.updatedAt);
  let latest = Date.parse(e.createdAt);
  const firstByPublisher = new Map<string, number>();
  for (const s of e.sources) {
    const k = publisherKey(s), t = Date.parse(s.retrievedAt) || sourceTime(s);
    if (!firstByPublisher.has(k) || t < firstByPublisher.get(k)!) firstByPublisher.set(k, t);
  }
  for (const t of firstByPublisher.values()) latest = Math.max(latest, t);
  for (const t of e.timeline) if (KEY_KINDS.has(t.kind)) latest = Math.max(latest, Date.parse(t.at) || 0);
  latest = Math.min(Number.isFinite(upd) ? upd : latest, latest);
  return trimEvent({ ...e, lastEvidenceAt: new Date(latest).toISOString() });
}
