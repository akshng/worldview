import { describe, expect, it } from "vitest";
import { buildDailyBriefing, classifyChange } from "@/lib/briefing";
import { createEvent, mergeCandidate } from "@/lib/events/build";
import { EventCandidateSchema } from "@/types/events";
import { candidate, NOW, source, iso } from "./helpers";

const geo = { country: "US", countryName: "United States", region: "North America", fallbackLocationName: null };
const H = 3_600_000;
const ev = (o: Parameters<typeof candidate>[0], createdAgo = 0) => createEvent(EventCandidateSchema.parse(candidate(o)), geo, NOW - createdAgo);

describe("briefing change classification", () => {
  it("marks events that started in the last 24 h as NEW, even if ingested earlier or later", () => {
    expect(classifyChange(ev({ timestamp: iso(2 * H) }), NOW)).toBe("NEW");
  });
  it("marks older events with recent activity as DEVELOPING", () => {
    const old = ev({ timestamp: iso(3 * 86_400_000) }, 3 * 86_400_000);
    const updated = mergeCandidate(
      old,
      EventCandidateSchema.parse(candidate({ timestamp: iso(3 * 86_400_000), source: source({ id: "gdacs:1", dataSourceId: "gdacs", externalId: "1", sourceUrl: "https://gdacs.org/1", assertion: "OFFICIAL_PRELIMINARY" }) })),
      NOW - 2 * H,
    ).event;
    expect(classifyChange(updated, NOW)).toBe("DEVELOPING");
  });
  it("uses the source's start time for long-running events", () => {
    const storm = ev({ type: "WEATHER", timestamp: iso(H), metrics: { started_at: iso(5 * 86_400_000) } });
    expect(classifyChange(storm, NOW)).toBe("DEVELOPING");
  });
  it("marks recently ended events as RESOLVED", () => {
    expect(classifyChange(ev({ type: "WEATHER", timestamp: iso(30 * H), resolvedAt: iso(H), source: source({ assertion: "OFFICIAL_PRELIMINARY" }) }), NOW)).toBe("RESOLVED");
  });
});

describe("briefing structure", () => {
  it("ranks, compares days, separates upcoming items and ignores synthetic data", () => {
    const events = [
      ev({ metrics: { magnitude: 7.1 }, timestamp: iso(H) }),
      ev({ metrics: { magnitude: 4.1 }, timestamp: iso(30 * H), source: source({ id: "usgs:y", externalId: "y" }) }),
      ev({ type: "SPACE", subtype: "launch", timestamp: new Date(NOW + 5 * H).toISOString(), source: source({ id: "ll2:1", dataSourceId: "space", externalId: "1", assertion: "SCHEDULED" }) }),
      { ...ev({ metrics: { magnitude: 8 }, source: source({ id: "demo:1", dataSourceId: "demo", externalId: "1", assertion: "SYNTHETIC", sourceType: "SYNTHETIC", sourceUrl: null }) }), isSynthetic: true },
    ];
    const b = buildDailyBriefing(events, NOW);
    expect(b.topDevelopments[0].event.metrics.magnitude).toBe(7.1);
    expect(b.topDevelopments.some((i) => i.event.isSynthetic)).toBe(false);
    expect(b.comparison.find((c) => c.category === "EARTHQUAKE")).toMatchObject({ today: 1, yesterday: 1 });
    expect(b.whatToWatch.map((i) => i.event.type)).toEqual(["SPACE"]);
    expect(b.sections.find((s) => s.id === "us")!.items.length).toBeGreaterThan(0);
    expect(b.aiNarrative).toBeNull();
  });
});
