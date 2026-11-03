/** Client-side filtering of already-fetched event summaries (fast, no round-trip). */
import type { EventCategory, EventSummary } from "@/types/events";
import type { TimeWindow } from "@/lib/time";

export interface ClientFilter {
  categories: ReadonlySet<EventCategory>;
  minImportance: number;
  window: TimeWindow;
  /** Only events reported by one of these sources (null/empty = all). */
  sources?: ReadonlySet<string> | null;
  /** Only these events (e.g. what the Analyst cited). */
  ids?: ReadonlySet<string> | null;
}

export function inWindow(timestamp: string, w: TimeWindow): boolean {
  const t = Date.parse(timestamp);
  return t >= w.from && (w.to === null || t <= w.to);
}

export function filterEvents(events: EventSummary[], f: ClientFilter): EventSummary[] {
  return events.filter(
    (e) =>
      (f.ids && f.ids.size
        ? f.ids.has(e.id)
        : f.categories.has(e.type) && e.importanceScore >= f.minImportance && inWindow(e.timestamp, f.window)) &&
      (!f.sources || !f.sources.size || (e.sourceIds ?? []).some((s) => f.sources!.has(s))),
  );
}
