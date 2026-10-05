import { describe, expect, it } from "vitest";
import { matchesQuery, parseEventQuery, sortEvents } from "@/lib/events/query";
import { filterEvents, inWindow } from "@/lib/events/client-filter";
import { visibleWindow } from "@/lib/time";
import { bboxContains, haversineKm, normalizeLon, pointInPolygon } from "@/lib/geo/math";
import { createEvent } from "@/lib/events/build";
import { EventCandidateSchema, toEventSummary } from "@/types/events";
import { candidate, NOW, iso } from "./helpers";

const ev = (o: Parameters<typeof candidate>[0] = {}) =>
  createEvent(EventCandidateSchema.parse(candidate(o)), { country: o.country ?? "JP", countryName: null, region: null, fallbackLocationName: null }, NOW);

describe("geographic helpers", () => {
  it("computes great-circle distance", () => {
    expect(haversineKm(51.5074, -0.1278, 48.8566, 2.3522)).toBeCloseTo(343.5, 0); // London–Paris
  });
  it("handles bounding boxes across the antimeridian", () => {
    const fiji: [number, number, number, number] = [177, -20, -178, -15];
    expect(bboxContains(fiji, -17, 179)).toBe(true);
    expect(bboxContains(fiji, -17, -179)).toBe(true);
    expect(bboxContains(fiji, -17, 0)).toBe(false);
  });
  it("wraps longitudes", () => {
    expect(normalizeLon(190)).toBe(-170);
    expect(normalizeLon(-190)).toBe(170);
  });
  it("tests points in polygons with holes", () => {
    const poly = [
      [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
      [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]],
    ];
    expect(pointInPolygon(2, 2, poly)).toBe(true);
    expect(pointInPolygon(5, 5, poly)).toBe(false);
    expect(pointInPolygon(11, 5, poly)).toBe(false);
  });
});

describe("query filtering", () => {
  const japan = ev();
  const chile = ev({ latitude: -33.4, longitude: -70.6, country: "CL", timestamp: iso(3 * 3_600_000) });
  const fire = ev({ type: "FIRE", metrics: { frp_total_mw: 50 }, timestamp: iso(30 * 3_600_000), country: "AU", latitude: -25, longitude: 135 });

  it("filters by date range", () => {
    expect(matchesQuery(japan, { from: iso(3_600_000) })).toBe(true);
    expect(matchesQuery(chile, { from: iso(3_600_000) })).toBe(false);
    expect(matchesQuery(fire, { from: iso(2 * 86_400_000), to: iso(86_400_000) })).toBe(true);
  });
  it("filters by type, country, importance and bbox", () => {
    expect(matchesQuery(fire, { type: ["EARTHQUAKE"] })).toBe(false);
    expect(matchesQuery(chile, { country: "CL" })).toBe(true);
    expect(matchesQuery(japan, { importance: 99 })).toBe(false);
    expect(matchesQuery(japan, { bbox: [130, 30, 146, 46] })).toBe(true);
    expect(matchesQuery(chile, { bbox: [130, 30, 146, 46] })).toBe(false);
  });
  it("matches free text across title, place and sources", () => {
    expect(matchesQuery(japan, { q: "sendai" })).toBe(true);
    expect(matchesQuery(japan, { q: "usgs sendai" })).toBe(true);
    expect(matchesQuery(japan, { q: "lisbon" })).toBe(false);
  });
  it("sorts by recency and importance", () => {
    expect(sortEvents([chile, japan], "recent", NOW)[0].id).toBe(japan.id);
  });
});

describe("client time windows", () => {
  it("is open-ended when live and bounded when replaying", () => {
    expect(visibleWindow("6h", NOW, null)).toEqual({ from: NOW - 6 * 3_600_000, to: null });
    const cursor = NOW - 12 * 3_600_000;
    expect(visibleWindow("1h", NOW, cursor)).toEqual({ from: cursor - 3_600_000, to: cursor });
  });
  it("includes scheduled future events in the live window", () => {
    expect(inWindow(new Date(NOW + 86_400_000).toISOString(), visibleWindow("24h", NOW, null))).toBe(true);
    expect(inWindow(new Date(NOW + 86_400_000).toISOString(), visibleWindow("24h", NOW, NOW - 1000))).toBe(false);
  });
  it("filters summaries by layer, importance and window", () => {
    const list = [toEventSummary(ev()), toEventSummary(ev({ type: "FIRE", metrics: {}, timestamp: iso(2 * 86_400_000) }))];
    const out = filterEvents(list, { categories: new Set(["EARTHQUAKE", "FIRE"]), minImportance: 0, window: visibleWindow("24h", NOW, null) });
    expect(out).toHaveLength(1);
    expect(filterEvents(list, { categories: new Set(["FIRE"]), minImportance: 0, window: visibleWindow("7d", NOW, null) })).toHaveLength(1);
  });
});

describe("API query validation", () => {
  it("parses and coerces valid parameters", () => {
    const r = parseEventQuery(new URLSearchParams("type=EARTHQUAKE,FIRE&country=jp&importance=40&limit=10&bbox=-10,30,40,60&from=2026-10-01T00:00:00Z"));
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.type).toEqual(["EARTHQUAKE", "FIRE"]);
    expect(r.data.country).toBe("JP");
    expect(r.data.importance).toBe(40);
    expect(r.data.bbox).toEqual([-10, 30, 40, 60]);
    expect(r.data.sort).toBe("recent");
  });
  it("rejects invalid parameters", () => {
    for (const q of ["type=NOPE", "importance=500", "bbox=1,2,3", "from=notadate", "limit=0", "country=Japan123"]) {
      expect(parseEventQuery(new URLSearchParams(q)).success, q).toBe(false);
    }
  });
});

describe("ocean naming", async () => {
  const { oceanName } = await import("@/lib/geo/math");
  it("labels open-ocean points", () => {
    expect(oceanName(16, 150)).toBe("North Pacific Ocean — west");
    expect(oceanName(25, -45)).toBe("North Atlantic Ocean");
    expect(oceanName(-20, 70)).toBe("South Indian Ocean");
  });
});
