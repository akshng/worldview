/**
 * One-pass duplicate collapse for stored events (run when a store is loaded), for
 * events stored before series keys and cross-source story matching existed:
 *
 *  - warning series: events with the same series key (NWS reissues for one polygon,
 *    MeteoAlarm time slices) whose periods overlap or nearly touch become one event
 *    spanning the whole period;
 *  - news stories: events carrying an identical (normalised) headline about the same
 *    country, within 36 h, become one event with all their sources.
 *
 * Pure; returns the surviving events and an old-id → new-id map for relationships.
 */
import type { WorldEvent } from "@/types/events";
import { absorbEvent, recompute } from "@/lib/events/build";
import { sourceKeys } from "@/lib/events/compact";
import { legacySeriesKey } from "@/lib/events/series";
import { tokenize } from "@/lib/deduplication/similarity";
import { NEWS_SOURCE_TYPES, normalizeHeadline, seriesTouch, STORY_WINDOW_MS } from "./story";

/** Merge two events of one series: union of periods; the newest record of the feed stays listed. */
export function absorbSeriesEvent(a: WorldEvent, b: WorldEvent, now = Date.now()): WorldEvent {
  const pub = (e: WorldEvent) => e.sources[0]?.publishedAt ?? e.updatedAt;
  const [older, newer] = pub(a) <= pub(b) ? [a, b] : [b, a];
  const m = absorbEvent(newer, older, now);
  const feed = newer.sources[0]?.dataSourceId;
  const drop = m.sources.filter((s, i) => i > 0 && s.dataSourceId === feed);
  const dropIds = new Set(drop.map((s) => s.id));
  const rawData = { ...m.rawData };
  for (const id of dropIds) delete rawData[id];
  const start = a.timestamp < b.timestamp ? a.timestamp : b.timestamp;
  const ends = [a.resolvedAt, b.resolvedAt].filter((x): x is string => !!x).sort();
  const resolvedAt = ends.length === 2 ? ends[1] : null;
  return recompute(
    {
      ...m,
      id: older.createdAt <= newer.createdAt ? older.id : newer.id,
      timestamp: start,
      resolvedAt: resolvedAt ?? m.resolvedAt,
      sources: m.sources.filter((s) => !dropIds.has(s.id)),
      rawData,
      sourcesOmitted: (m.sourcesOmitted ?? 0) + drop.length,
      seenSourceKeys: [...new Set([...(m.seenSourceKeys ?? []), ...drop.flatMap(sourceKeys)])],
      // An earlier slice's "ended" entry no longer applies when the series runs on.
      timeline: resolvedAt && Date.parse(resolvedAt) > now ? m.timeline.filter((t) => t.kind !== "RESOLVED") : m.timeline,
    },
    now,
  );
}

export function collapseDuplicates(input: WorldEvent[], now = Date.now()): { events: WorldEvent[]; remap: Map<string, string> } {
  const remap = new Map<string, string>();
  const alive = new Map<string, WorldEvent>();
  for (const e of input) {
    const seriesKey = legacySeriesKey(e);
    alive.set(e.id, seriesKey && seriesKey !== e.seriesKey ? { ...e, seriesKey } : e);
  }
  const replace = (gone: string[], survivor: WorldEvent) => {
    for (const id of gone) {
      alive.delete(id);
      if (id !== survivor.id) remap.set(id, survivor.id);
    }
    alive.set(survivor.id, survivor);
  };

  // 1. Warning series.
  const bySeries = new Map<string, WorldEvent[]>();
  for (const e of alive.values()) {
    if (!e.seriesKey) continue;
    const list = bySeries.get(e.seriesKey) ?? [];
    list.push(e);
    bySeries.set(e.seriesKey, list);
  }
  for (const list of bySeries.values()) {
    if (list.length < 2) continue;
    list.sort((x, y) => Date.parse(x.timestamp) - Date.parse(y.timestamp));
    let cur = list[0];
    for (const next of list.slice(1)) {
      if (seriesTouch(cur, next)) {
        const merged = absorbSeriesEvent(cur, next, now);
        replace([cur.id, next.id], merged);
        cur = merged;
      } else {
        cur = next;
      }
    }
  }

  // 2. Same news story across outlets/feeds: identical headline, same country, within 36 h.
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    let r = id;
    while (parent.has(r) && parent.get(r) !== r) r = parent.get(r)!;
    return r;
  };
  const byHeadline = new Map<string, WorldEvent[]>();
  for (const e of alive.values()) {
    if (!e.sources.some((s) => NEWS_SOURCE_TYPES.has(s.sourceType))) continue;
    for (const t of new Set(e.sources.map((s) => (s.title ? normalizeHeadline(s.title) : "")))) {
      if (!t || tokenize(t).size < 4) continue;
      const k = `${e.country ?? "?"}|${t}`;
      const list = byHeadline.get(k) ?? [];
      list.push(e);
      byHeadline.set(k, list);
    }
  }
  for (const list of byHeadline.values()) {
    if (list.length < 2) continue;
    list.sort((x, y) => Date.parse(x.timestamp) - Date.parse(y.timestamp));
    for (let i = 1; i < list.length; i++) {
      if (Date.parse(list[i].timestamp) - Date.parse(list[i - 1].timestamp) > STORY_WINDOW_MS) continue;
      const a = find(list[i - 1].id), b = find(list[i].id);
      if (a !== b) parent.set(b, a);
    }
  }
  const groups = new Map<string, WorldEvent[]>();
  for (const id of parent.keys()) {
    const root = find(id);
    const g = groups.get(root) ?? [alive.get(root)!];
    g.push(alive.get(id)!);
    groups.set(root, g);
  }
  for (const g of groups.values()) {
    const members = [...new Set(g)].sort((x, y) => x.createdAt.localeCompare(y.createdAt));
    let merged = members[0];
    for (const other of members.slice(1)) merged = absorbEvent(merged, other, now);
    merged = { ...merged, id: members[0].id };
    replace(members.map((m) => m.id), merged);
  }

  // Resolve chains (a → b → c) and fix related-event links.
  for (const [from, to] of remap) {
    let t = to;
    while (remap.has(t)) t = remap.get(t)!;
    remap.set(from, t);
  }
  const events = [...alive.values()].map((e) => {
    if (!e.relatedEventIds.some((id) => remap.has(id))) return e;
    const ids = [...new Set(e.relatedEventIds.map((id) => remap.get(id) ?? id))].filter((id) => id !== e.id);
    return { ...e, relatedEventIds: ids };
  });
  return { events, remap };
}
