import { describe, expect, it } from "vitest";
import { filterEvents } from "@/lib/events/client-filter";
import type { EventSummary } from "@/types/events";

const ev = (id: string, type: string, sourceIds: string[], importanceScore = 50) => ({ id, type, sourceIds, importanceScore, timestamp: "2026-11-02T12:00:00Z" }) as unknown as EventSummary;
const all = new Set(["NEWS", "MARKETS", "POLITICS"]) as never;
const window = { from: Date.parse("2026-11-01"), to: null };

describe("plot filters", () => {
  const events = [ev("a", "MARKETS", ["central-banks"]), ev("b", "POLITICS", ["ofac-sanctions", "news-rss"]), ev("c", "NEWS", ["news-rss"], 10)];
  it("plots only the picked sources", () => {
    expect(filterEvents(events, { categories: all, minImportance: 0, window, sources: new Set(["ofac-sanctions"]) }).map((e) => e.id)).toEqual(["b"]);
    expect(filterEvents(events, { categories: all, minImportance: 0, window, sources: new Set() }).length).toBe(3);
  });
  it("plots an exact set of events regardless of the other filters", () => {
    expect(filterEvents(events, { categories: new Set() as never, minImportance: 90, window, ids: new Set(["c"]) }).map((e) => e.id)).toEqual(["c"]);
  });
});
