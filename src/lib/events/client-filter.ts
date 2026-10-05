/** Client-side filtering of already-fetched event summaries (fast, no round-trip). */
import type { EventCategory, EventSummary } from "@/types/events";
import type { TimeWindow } from "@/lib/time";

export interface ClientFilter {
  categories: ReadonlySet<EventCategory>;
  minImportance: number;
  window: TimeWindow;
}

export function inWindow(timestamp: string, w: TimeWindow): boolean {
  const t = Date.parse(timestamp);
  return t >= w.from && (w.to === null || t <= w.to);
}

export function filterEvents(events: EventSummary[], f: ClientFilter): EventSummary[] {
  return events.filter(
    (e) => f.categories.has(e.type) && e.importanceScore >= f.minImportance && inWindow(e.timestamp, f.window),
  );
}
