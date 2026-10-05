import { describe, expect, it } from "vitest";
import { MemoryEventRepository } from "@/lib/db/memory-repository";
import { ingestCandidates } from "@/lib/ingestion/pipeline";
import { reverseGeocode, describeNearest } from "@/lib/geo/gazetteer";
import { candidate, NOW, source } from "./helpers";

const opts = { mergeWithinSource: new Set(["gdelt"]), now: NOW };

describe("gazetteer", () => {
  it("reverse geocodes points to ISO countries", () => {
    expect(reverseGeocode(48.8566, 2.3522).country?.code).toBe("FR");
    expect(reverseGeocode(35.68, 139.69).country?.code).toBe("JP");
    expect(reverseGeocode(-33.87, 151.21).country?.code).toBe("AU");
  });
  it("falls back to the nearest country for near-shore points and gives up mid-ocean", () => {
    const offshore = reverseGeocode(38.3, 142.4); // off Tōhoku
    expect(offshore.country?.code).toBe("JP");
    expect(offshore.approximate).toBe(true);
    expect(reverseGeocode(-40, -130).country).toBeNull(); // South Pacific
  });
  it("describes positions relative to the nearest city", () => {
    expect(describeNearest(48.9, 2.35)).toMatch(/Paris/);
  });
});

describe("ingestion pipeline", () => {
  it("creates, upserts and deduplicates across sources", async () => {
    const repo = new MemoryEventRepository(null);
    const first = await ingestCandidates(repo, [candidate()], opts);
    expect(first.created).toBe(1);

    // Same record again → unchanged
    const again = await ingestCandidates(repo, [candidate()], opts);
    expect(again.unchanged).toBe(1);

    // Same quake from GDACS → merged into the USGS event
    const gdacs = candidate({
      title: "M 6.1 earthquake — Japan",
      latitude: 38.35,
      longitude: 141.55,
      metrics: { magnitude: 6.1, alert_level: "green" },
      source: source({ id: "gdacs:EQ-9", dataSourceId: "gdacs", externalId: "EQ-9", sourceName: "GDACS", sourceUrl: "https://www.gdacs.org/r?id=9", assertion: "OFFICIAL_PRELIMINARY" }),
    });
    const merged = await ingestCandidates(repo, [gdacs], opts);
    expect(merged.deduplicated).toBe(1);
    expect(await repo.count()).toBe(1);
    const [e] = (await repo.query({})).events;
    expect(e.sourceCount).toBe(2);
    expect(e.country).toBe("JP");
    expect(e.status).toBe("CONFIRMED");
  });

  it("rejects invalid candidates without failing the batch", async () => {
    const repo = new MemoryEventRepository(null);
    const r = await ingestCandidates(repo, [candidate({ latitude: 200 }), candidate({ source: source({ id: "usgs:x2", externalId: "x2" }), timestamp: new Date(NOW - 7_200_000).toISOString() })], opts);
    expect(r.invalid).toBe(1);
    expect(r.created).toBe(1);
    expect(r.errors[0]).toMatch(/latitude/);
  });

  it("supports spatial lookups across the antimeridian", async () => {
    const repo = new MemoryEventRepository(null);
    await ingestCandidates(repo, [candidate({ latitude: -17, longitude: 179.9, source: source({ id: "usgs:fj", externalId: "fj" }) })], opts);
    const near = await repo.findNear({ lat: -17, lon: -179.9, radiusKm: 50, fromMs: 0, toMs: NOW * 2 });
    expect(near).toHaveLength(1);
  });
});

describe("superseding records", () => {
  it("updates the original event when an alert update arrives", async () => {
    const repo = new MemoryEventRepository(null);
    const alert = (id: string, title: string, supersedes: string[] = []) =>
      candidate({
        type: "FLOOD",
        title,
        supersedes,
        source: source({ id: `nws:${id}`, dataSourceId: "nws", externalId: id, sourceName: "U.S. National Weather Service", sourceUrl: `https://api.weather.gov/alerts/${id}`, assertion: "OFFICIAL_PRELIMINARY" }),
      });
    await ingestCandidates(repo, [alert("a1", "Flood Warning — Gage, NE")], opts);
    const r = await ingestCandidates(repo, [alert("a2", "Flood Warning — Gage, NE; Saline, NE", ["nws:a1"])], opts);
    expect(r.updated).toBe(1);
    expect(await repo.count()).toBe(1);
    const [e] = (await repo.query({})).events;
    expect(e.title).toBe("Flood Warning — Gage, NE; Saline, NE");
    expect(e.sources.map((s) => s.id)).toEqual(["nws:a2"]);
    expect(e.timeline.some((t) => t.kind === "UPDATE")).toBe(true);
    // The superseding record is now the lookup key
    expect(await repo.findBySourceRecord("nws:a2")).not.toBeNull();
  });
});

describe("regions", async () => {
  const { regionFor } = await import("@/lib/ingestion/pipeline");
  it("splits Russia by longitude", () => {
    expect(regionFor("RU", "Europe", 37.6)).toBe("Europe");
    expect(regionFor("RU", "Europe", 158.6)).toBe("Asia");
    expect(regionFor("FR", "Europe", 2)).toBe("Europe");
  });
});
