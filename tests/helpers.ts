import type { EventCandidateInput, EventSource } from "@/types/events";

export const NOW = Date.parse("2026-10-04T12:00:00Z");
export const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

export function source(overrides: Partial<EventSource> = {}): EventSource {
  return {
    id: "usgs:abc",
    dataSourceId: "usgs",
    externalId: "abc",
    sourceName: "USGS Earthquake Hazards Program",
    sourceUrl: "https://earthquake.usgs.gov/earthquakes/eventpage/abc",
    title: null,
    titleIsDerived: false,
    publishedAt: iso(0),
    retrievedAt: iso(0),
    sourceType: "OFFICIAL_AGENCY",
    assertion: "OFFICIAL_FINAL",
    credibility: null,
    ...overrides,
  };
}

export function candidate(overrides: Partial<EventCandidateInput> = {}): EventCandidateInput {
  return {
    type: "EARTHQUAKE",
    subtype: "earthquake",
    title: "M 6.2 earthquake — 40 km E of Sendai, Japan",
    summary: "USGS reports a magnitude 6.2 earthquake.",
    latitude: 38.27,
    longitude: 141.4,
    geoPrecision: "exact",
    locationName: "40 km E of Sendai, Japan",
    timestamp: iso(10 * 60_000),
    metrics: { magnitude: 6.2 },
    entities: [],
    source: source(),
    ...overrides,
  };
}
