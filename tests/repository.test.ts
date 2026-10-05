/**
 * Repository contract: every EventRepository implementation must behave the same.
 * Runs against the in-memory store and real Postgres (embedded PGlite).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { EventRepository } from "@/lib/db/types";
import { MemoryEventRepository } from "@/lib/db/memory-repository";
import { PostgresEventRepository } from "@/lib/db/postgres/repository";
import { createPgliteClient } from "@/lib/db/postgres/client";
import { createEvent } from "@/lib/events/build";
import { ingestCandidates } from "@/lib/ingestion/pipeline";
import { EventCandidateSchema } from "@/types/events";
import { candidate, NOW, source, iso } from "./helpers";

const geo = (country: string) => ({ country, countryName: null, region: null, fallbackLocationName: null });
const mk = (id: string, o: Parameters<typeof candidate>[0] = {}, country = "JP") =>
  createEvent(EventCandidateSchema.parse(candidate({ source: source({ id: `usgs:${id}`, externalId: id }), ...o })), geo(country), NOW, id);

const impls: Array<[string, () => Promise<EventRepository>]> = [
  ["memory", async () => new MemoryEventRepository(null)],
  ["postgres (pglite)", async () => new PostgresEventRepository(await createPgliteClient(null))],
];

describe.each(impls)("EventRepository contract — %s", (_name, factory) => {
  let repo: EventRepository;
  beforeAll(async () => {
    repo = await factory();
    await repo.init();
    await repo.init(); // idempotent
  }, 30_000);
  afterAll(async () => {
    await (repo as { close?: () => Promise<void> }).close?.();
  });

  it("saves, reads and indexes source records", async () => {
    const e = mk("a1");
    await repo.save(e);
    expect((await repo.get("a1"))?.title).toBe(e.title);
    expect((await repo.findBySourceRecord("usgs:a1"))?.id).toBe("a1");
    expect(await repo.get("missing")).toBeNull();
    expect((await repo.getMany(["a1", "missing"])).map((x) => x.id)).toEqual(["a1"]);
    // update in place
    await repo.save({ ...e, title: "Updated" });
    expect((await repo.get("a1"))?.title).toBe("Updated");
    expect(await repo.count()).toBe(1);
  });

  it("filters and sorts like matchesQuery", async () => {
    await repo.saveMany([
      mk("b1", { timestamp: iso(2 * 3_600_000), latitude: -33.4, longitude: -70.6, metrics: { magnitude: 7 } }, "CL"),
      mk("b2", { type: "FIRE", timestamp: iso(30 * 3_600_000), latitude: -25, longitude: 135, metrics: {} }, "AU"),
      mk("b3", { latitude: -17, longitude: 179.5, title: "M 5.0 earthquake — Fiji region" }, "FJ"),
    ]);
    const all = await repo.query({ limit: 50 });
    expect(all.total).toBe(4);
    expect((await repo.query({ type: ["FIRE"] })).events.map((e) => e.id)).toEqual(["b2"]);
    expect((await repo.query({ country: "CL" })).events.map((e) => e.id)).toEqual(["b1"]);
    expect((await repo.query({ from: iso(24 * 3_600_000) })).total).toBe(3);
    expect((await repo.query({ q: "fiji" })).events.map((e) => e.id)).toEqual(["b3"]);
    expect((await repo.query({ q: "fiji usgs" })).total).toBe(1);
    expect((await repo.query({ q: "100%_" })).total).toBe(0); // LIKE wildcards are escaped
    expect((await repo.query({ bbox: [170, -25, -170, -10] })).events.map((e) => e.id)).toEqual(["b3"]); // antimeridian
    expect((await repo.query({ sort: "importance", limit: 1 })).events[0].id).toBe("b1");
    const page = await repo.query({ limit: 2, offset: 2 });
    expect(page.events).toHaveLength(2);
    expect(page.total).toBe(4);
    expect((await repo.scan({ type: ["EARTHQUAKE"] })).length).toBe(3);
  });

  it("finds nearby events, including across the antimeridian", async () => {
    const near = await repo.findNear({ lat: -17, lon: -179.8, radiusKm: 100, fromMs: 0, toMs: NOW * 2 });
    expect(near.map((e) => e.id)).toEqual(["b3"]);
    expect(await repo.findNear({ lat: -17, lon: -179.8, radiusKm: 100, fromMs: 0, toMs: NOW * 2, type: "FIRE" })).toHaveLength(0);
  });

  it("stores relationships once, in either direction", async () => {
    const rel = { fromEventId: "a1", toEventId: "b1", type: "POSSIBLY_RELATED" as const, basis: "test", createdAt: iso(0) };
    await repo.addRelationship(rel);
    await repo.addRelationship({ ...rel, fromEventId: "b1", toEventId: "a1" });
    expect(await repo.relationshipsFor("a1")).toHaveLength(1);
    expect((await repo.relationshipsFor("b1"))[0]).toMatchObject({ fromEventId: "a1", toEventId: "b1", basis: "test" });
  });

  it("logs ingestion runs newest first", async () => {
    const run = (id: string, startedAt: string) => ({
      id, dataSourceId: "usgs", startedAt, completedAt: startedAt, success: true, recordsReceived: 1, recordsCreated: 1,
      recordsUpdated: 0, recordsDeduplicated: 0, recordsSkipped: 0, recordsInvalid: 0, errors: [], durationMs: 5,
    });
    await repo.recordRun(run("r1", iso(60_000)));
    await repo.recordRun(run("r2", iso(0)));
    await repo.recordRun({ ...run("r2", iso(0)), recordsCreated: 9 }); // upsert
    const runs = await repo.listRuns({ dataSourceId: "usgs" });
    expect(runs.map((r) => r.id)).toEqual(["r2", "r1"]);
    expect(runs[0].recordsCreated).toBe(9);
  });

  it("runs the ingestion pipeline with dedup and related-event linking", async () => {
    const gdacs = candidate({
      title: "M 7.0 earthquake — Chile",
      latitude: -33.5,
      longitude: -70.5,
      timestamp: iso(2 * 3_600_000 - 60_000),
      metrics: { magnitude: 7.0, alert_level: "orange" },
      source: source({ id: "gdacs:EQ-1", dataSourceId: "gdacs", externalId: "EQ-1", sourceName: "GDACS", sourceUrl: "https://www.gdacs.org/r?1", assertion: "OFFICIAL_PRELIMINARY" }),
    });
    const tsunami = candidate({
      type: "WEATHER",
      title: "Tsunami Warning — coast of Chile",
      latitude: -33.0,
      longitude: -71.6,
      timestamp: iso(3_600_000),
      metrics: {},
      source: source({ id: "nws:t1", dataSourceId: "nws", externalId: "t1", sourceName: "NWS", sourceUrl: "https://api.weather.gov/alerts/t1", assertion: "OFFICIAL_PRELIMINARY" }),
    });
    const r = await ingestCandidates(repo, [gdacs, tsunami], { mergeWithinSource: new Set(), now: NOW });
    expect(r.deduplicated).toBe(1);
    expect(r.created).toBe(1);
    expect((await repo.get("b1"))?.sourceCount).toBe(2);
    const t = await repo.findBySourceRecord("nws:t1");
    expect(t?.relatedEventIds).toContain("b1");
    expect((await repo.relationshipsFor(t!.id)).length).toBeGreaterThan(0);
  });

  it("prunes old events and removes events by source", async () => {
    // Pruning uses the later of event time and last update.
    await repo.save({ ...(await repo.get("b2"))!, updatedAt: iso(30 * 3_600_000) });
    const removed = await repo.prune(NOW - 24 * 3_600_000);
    expect(removed).toBe(1); // the 30 h-old fire
    expect(await repo.get("b2")).toBeNull();
    const before = await repo.count();
    expect(await repo.removeBySource("nws")).toBe(1);
    expect(await repo.count()).toBe(before - 1);
  });
});
