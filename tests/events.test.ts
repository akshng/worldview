import { describe, expect, it } from "vitest";
import { EventCandidateSchema, WorldEventSchema } from "@/types/events";
import { createEvent, mergeCandidate } from "@/lib/events/build";
import { normalizeCandidate } from "@/lib/ingestion/pipeline";
import { candidate, NOW, source, iso } from "./helpers";

const geo = { country: "JP", countryName: "Japan", region: "Asia", fallbackLocationName: null };

describe("event validation", () => {
  it("accepts a well-formed candidate", () => {
    expect(EventCandidateSchema.safeParse(candidate()).success).toBe(true);
  });

  it("rejects out-of-range coordinates", () => {
    expect(EventCandidateSchema.safeParse(candidate({ latitude: 91 })).success).toBe(false);
    expect(EventCandidateSchema.safeParse(candidate({ longitude: -181 })).success).toBe(false);
  });

  it("rejects unknown categories and bad timestamps", () => {
    expect(EventCandidateSchema.safeParse(candidate({ type: "ALIENS" as never })).success).toBe(false);
    expect(EventCandidateSchema.safeParse(candidate({ timestamp: "yesterday" })).success).toBe(false);
  });

  it("rejects non-http source URLs (no javascript: links)", () => {
    const bad = candidate({ source: source({ sourceUrl: "javascript:alert(1)" }) });
    expect(EventCandidateSchema.safeParse(bad).success).toBe(false);
  });
});

describe("normalisation", () => {
  it("trims whitespace, wraps longitude and upper-cases country codes", () => {
    const c = EventCandidateSchema.parse(candidate({ title: "  M 6.2   quake  ", longitude: 180, country: "jp" }));
    const n = normalizeCandidate({ ...c, longitude: 190 - 10 });
    expect(n.title).toBe("M 6.2 quake");
    expect(n.country).toBe("JP");
    expect(Math.abs(n.longitude)).toBeLessThanOrEqual(180);
  });
});

describe("event creation", () => {
  it("creates a schema-valid WorldEvent with derived fields", () => {
    const e = createEvent(EventCandidateSchema.parse(candidate()), geo, NOW);
    expect(WorldEventSchema.safeParse(e).success).toBe(true);
    expect(e.status).toBe("CONFIRMED");
    expect(e.sourceCount).toBe(1);
    expect(e.importanceScore).toBeGreaterThan(40);
    expect(e.aiInterpretation).toBeNull();
    expect(e.timeline[0].kind).toBe("OFFICIAL_CONFIRMATION");
  });

  it("uses geo enrichment when the source has no location name", () => {
    const e = createEvent(EventCandidateSchema.parse(candidate({ locationName: null })), { ...geo, fallbackLocationName: "Near Sendai" }, NOW);
    expect(e.locationName).toBe("Near Sendai");
    expect(e.country).toBe("JP");
  });
});

describe("merging", () => {
  it("adds a corroborating source and keeps the authoritative one primary", () => {
    const usgs = createEvent(EventCandidateSchema.parse(candidate()), geo, NOW);
    const gdacs = EventCandidateSchema.parse(
      candidate({
        title: "M 6.1 earthquake — Japan",
        metrics: { magnitude: 6.1, alert_level: "orange" },
        source: source({ id: "gdacs:EQ-1", dataSourceId: "gdacs", externalId: "EQ-1", sourceName: "GDACS", sourceUrl: "https://www.gdacs.org/report.aspx?eventid=1", assertion: "OFFICIAL_PRELIMINARY" }),
      }),
    );
    const { event, kind } = mergeCandidate(usgs, gdacs, NOW);
    expect(kind).toBe("corroborated");
    expect(event.sourceCount).toBe(2);
    expect(event.sources[0].dataSourceId).toBe("usgs");
    expect(event.title).toBe(usgs.title); // lower-authority source does not overwrite
    expect(event.metrics.magnitude).toBe(6.2);
    expect(event.metrics.alert_level).toBe("orange"); // fills gaps
    expect(event.timeline.some((t) => t.kind === "SOURCE_ADDED")).toBe(true);
  });

  it("records an update when the same source revises magnitude", () => {
    const e = createEvent(EventCandidateSchema.parse(candidate({ source: source({ assertion: "OFFICIAL_PRELIMINARY" }) })), geo, NOW);
    expect(e.status).toBe("REPORTED");
    const revised = EventCandidateSchema.parse(candidate({ metrics: { magnitude: 6.4 }, source: source({ assertion: "OFFICIAL_FINAL" }) }));
    const { event, kind } = mergeCandidate(e, revised, NOW);
    expect(kind).toBe("updated");
    expect(event.metrics.magnitude).toBe(6.4);
    expect(event.status).toBe("CONFIRMED");
    expect(event.timeline.some((t) => t.kind === "OFFICIAL_CONFIRMATION")).toBe(true);
  });

  it("ignores an identical re-fetch", () => {
    const c = EventCandidateSchema.parse(candidate());
    const e = createEvent(c, geo, NOW);
    expect(mergeCandidate(e, c, NOW).changed).toBe(false);
  });

  it("does not attach the same article twice under different ids", () => {
    const a = EventCandidateSchema.parse(candidate({ type: "PROTEST", source: source({ id: "gdelt:1", dataSourceId: "gdelt", externalId: "1", sourceUrl: "https://news.example/a", assertion: "MEDIA_REPORT" }) }));
    const b = EventCandidateSchema.parse(candidate({ type: "PROTEST", source: source({ id: "gdelt:2", dataSourceId: "gdelt", externalId: "2", sourceUrl: "https://news.example/a", assertion: "MEDIA_REPORT" }) }));
    const e = createEvent(a, geo, NOW);
    expect(mergeCandidate(e, b, NOW).event.sourceCount).toBe(1);
  });

  it("marks events resolved when the source end time has passed", () => {
    const c = EventCandidateSchema.parse(candidate({ type: "WEATHER", resolvedAt: iso(60_000), source: source({ assertion: "OFFICIAL_PRELIMINARY" }) }));
    expect(createEvent(c, geo, NOW).status).toBe("RESOLVED");
  });
});
