import { afterEach, describe, expect, it, vi } from "vitest";
import type { EventCandidateInput, EventSource, WorldEvent } from "@/types/events";
import { EventCandidateSchema, toEventSummary } from "@/types/events";
import { createEvent, mergeCandidate } from "@/lib/events/build";
import { MAX_SOURCES, MAX_TIMELINE, retentionTime, selectSources, trimEvent } from "@/lib/events/compact";
import { MemoryEventRepository, migrateSnapshot } from "@/lib/db/memory-repository";
import { decodeEvent, encodeEvent, StringTable } from "@/lib/db/snapshot-codec";
import { ingestCandidates, normalizeHeadline } from "@/lib/ingestion/pipeline";
import { collapseDuplicates } from "@/lib/ingestion/collapse";
import { nwsRecordId, parseNwsAlerts, parseVtec } from "@/data-sources/weather/parser";
import { parseMeteoAlarm } from "@/data-sources/meteoalarm/parser";
import { slotPlan, fetchSlots, SLOT_MS } from "@/data-sources/gdelt/slots";
import type { NwsAlertCollection } from "@/data-sources/weather/types";
import type { MeteoAlarmRaw } from "@/data-sources/meteoalarm/types";
import { candidate, iso, NOW, source } from "./helpers";

const geo = { country: "US", countryName: "United States", region: "North America", fallbackLocationName: null };
const opts = { mergeWithinSource: new Set(["gdelt-gkg"]), now: NOW };

function article(i: number, host = `outlet${i}.com`, minutesAgo = 600 - i): EventSource {
  return source({
    id: `gdelt-gkg:a${i}`,
    dataSourceId: "gdelt-gkg",
    externalId: `a${i}`,
    sourceName: host,
    sourceUrl: `https://${host}/story-${i}`,
    title: "Pennsylvania's measles outbreak is the largest in decades in the US",
    publishedAt: iso(minutesAgo * 60_000),
    retrievedAt: iso(minutesAgo * 60_000),
    sourceType: "NEWS_MEDIA",
    assertion: "MEDIA_REPORT",
  });
}

const story = (i: number, host?: string, minutesAgo?: number) =>
  EventCandidateSchema.parse(
    candidate({
      type: "HEALTH",
      subtype: "disease",
      title: "Pennsylvania's measles outbreak is the largest in decades in the US",
      summary: "outlet reported",
      latitude: 40.9,
      longitude: -77.8,
      geoPrecision: "region",
      metrics: {},
      source: article(i, host, minutesAgo),
      rawData: { themes: Array.from({ length: 20 }, (_, k) => `THEME_${k}`) },
    }),
  );

function syndicated(n: number): WorldEvent {
  let e = createEvent(story(0), geo, NOW);
  for (let i = 1; i < n; i++) e = mergeCandidate(e, story(i), NOW).event;
  return e;
}

describe("store caps", () => {
  it("caps sources and timeline but keeps the totals and outlet count", () => {
    const e = syndicated(60);
    expect(e.sources.length).toBe(MAX_SOURCES);
    expect(e.sourceCount).toBe(60);
    expect(e.sourcesOmitted).toBe(60 - MAX_SOURCES);
    expect(e.outletCount).toBe(60);
    expect(e.timeline.length).toBeLessThanOrEqual(MAX_TIMELINE);
    expect((e.timelineOmitted ?? 0) + e.timeline.length).toBe(60);
    expect(e.timeline[0].kind).toBe("INITIAL_REPORT");
    // Corroboration still counts every outlet, not just the listed sources.
    expect(e.importanceFactors.find((f) => f.factor === "corroboration")?.detail).toMatch(/^60 /);
    expect(toEventSummary(e).outletCount).toBe(60);
    // News raw records are not kept (they repeat the source fields).
    expect(e.rawData).toEqual({});
  });

  it("never re-attaches a trimmed source", () => {
    const e = syndicated(30);
    const again = mergeCandidate(e, story(3), NOW); // a3 was trimmed
    expect(again.changed).toBe(false);
  });

  it("keeps the primary, first and latest reports and prefers distinct publishers", () => {
    const sources = [
      ...Array.from({ length: 20 }, (_, i) => article(i, "same.com", 500 - i)),
      article(50, "other-a.com", 100),
      article(51, "other-b.com", 90),
      article(52, "latest.com", 1),
    ];
    const kept = selectSources(sources, 5);
    expect(kept[0].id).toBe(sources[0].id);
    expect(kept.map((s) => s.sourceName)).toEqual(expect.arrayContaining(["other-a.com", "other-b.com", "latest.com"]));
  });

  it("caps raw records of official sources", () => {
    const big = { text: "x".repeat(5000), list: Array.from({ length: 50 }, (_, i) => i) };
    const e = trimEvent(createEvent(EventCandidateSchema.parse(candidate({ rawData: big })), geo, NOW));
    expect(JSON.stringify(e.rawData).length).toBeLessThan(1000);
  });

  it("retention follows new outlets, not repeat copies from the same outlet", () => {
    const later = NOW + 5 * 86_400_000;
    let e = createEvent(story(0, "a.com"), geo, NOW);
    e = mergeCandidate(e, story(1, "a.com"), later).event; // same outlet, new article
    expect(e.updatedAt).toBe(new Date(later).toISOString());
    expect(e.lastEvidenceAt).toBe(new Date(NOW).toISOString());
    e = mergeCandidate(e, story(2, "b.com"), later).event; // new outlet
    expect(retentionTime(e)).toBe(later);
  });
});

describe("snapshot", () => {
  it("encodes events losslessly and compactly", () => {
    const e = syndicated(15);
    const table = new StringTable();
    const enc = encodeEvent(e, table);
    const back = decodeEvent(JSON.parse(JSON.stringify(enc)), new StringTable(table.strings));
    const { importanceFactors: _a, importanceScore: _b, confidenceScore: _c, status: _d, sourceCount: _e, outletCount: _f, ...rest } = e;
    void [_a, _b, _c, _d, _e, _f];
    expect(back).toMatchObject(rest);
    expect(JSON.stringify(enc).length).toBeLessThan(JSON.stringify(e).length * 0.75);
  });

  it("migrates a legacy store on load: trims, backfills and collapses duplicates", async () => {
    const huge = { ...syndicated(5) };
    // Simulate a version-1 event: 40 sources, no caps, no bookkeeping fields.
    const legacy: WorldEvent = {
      ...huge,
      sources: Array.from({ length: 40 }, (_, i) => article(i)),
      timeline: Array.from({ length: 40 }, (_, i) => ({ at: iso((600 - i) * 60_000), kind: "SOURCE_ADDED" as const, label: `Also reported by outlet${i}.com`, sourceId: `gdelt-gkg:a${i}` })),
      outletCount: undefined,
      sourcesOmitted: undefined,
      lastEvidenceAt: undefined,
      publisherKeys: undefined,
    };
    const { events } = migrateSnapshot([legacy], [], NOW);
    expect(events[0].sources.length).toBe(MAX_SOURCES);
    expect(events[0].sourceCount).toBe(40);
    expect(events[0].outletCount).toBe(40);
    expect(events[0].lastEvidenceAt).toBeTruthy();

    // Round trip through the repository file.
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wv-")), "store.json");
    fs.writeFileSync(file, JSON.stringify({ version: 1, savedAt: iso(0), events: [legacy], relationships: [], runs: [] }));
    const repo = new MemoryEventRepository(file);
    await repo.init();
    await repo.flush();
    const reloaded = new MemoryEventRepository(file);
    await reloaded.init();
    const got = (await reloaded.get(legacy.id))!;
    expect(got.sourceCount).toBe(40);
    expect(got.sources[0]).toEqual(events[0].sources[0]);
    expect(JSON.parse(fs.readFileSync(file, "utf8")).version).toBe(2);
  });

  it("collapses identical headlines across feeds and MeteoAlarm time slices", () => {
    const rss = createEvent(
      EventCandidateSchema.parse(
        candidate({
          type: "NEWS",
          title: "Ethiopia expels Sudanese diplomats after fresh allegations of support for RSF",
          latitude: 8.03,
          longitude: 39.09,
          country: "ET",
          source: source({ id: "news-rss:x:1", dataSourceId: "news-rss", externalId: "x:1", sourceName: "Outlet", sourceUrl: "https://outlet.example/a", title: "Ethiopia expels Sudanese diplomats after fresh allegations of support for RSF", sourceType: "NEWS_MEDIA", assertion: "MEDIA_REPORT" }),
        }),
      ),
      { ...geo, country: "ET" },
      NOW,
    );
    const gd = createEvent(
      EventCandidateSchema.parse(
        candidate({
          type: "POLITICS",
          title: "Diplomatic expulsion — Ethiopia",
          latitude: 13.5,
          longitude: 39.5,
          country: "ET",
          timestamp: iso(3_600_000),
          source: source({ id: "gdelt:9", dataSourceId: "gdelt", externalId: "9", sourceName: "other.example", sourceUrl: "https://other.example/b", title: "ethiopia expels sudanese diplomats after fresh allegations of support for rsf", titleIsDerived: true, sourceType: "NEWS_AGGREGATOR", assertion: "MEDIA_REPORT" }),
        }),
      ),
      { ...geo, country: "ET" },
      NOW,
    );
    const { events, remap } = collapseDuplicates([rss, gd], NOW);
    expect(events).toHaveLength(1);
    expect(events[0].outletCount).toBe(2);
    expect(remap.size).toBe(1);
  });
});

describe("NWS VTEC", () => {
  const sent = "2026-10-04T11:00:00-07:00";
  it("parses VTEC and builds a stable record id", () => {
    expect(parseVtec("/O.EXT.KPSR.FL.W.0012.000000T0000Z-261106T0300Z/", sent)).toMatchObject({ action: "EXT", office: "KPSR", phenomena: "FL", significance: "W", etn: "0012", year: 2026 });
    expect(nwsRecordId({ id: "urn:1", sent, parameters: { VTEC: ["/O.CON.KPSR.FL.W.0012.000000T0000Z-261106T0300Z/"] } })).toBe("vtec:KPSR.FL.W.0012.2026");
    expect(nwsRecordId({ id: "urn:1", sent })).toBe("urn:1");
  });

  const alert = (id: string, vtec: string, ends: string, messageType = "Update"): NwsAlertCollection["features"][number] => ({
    id,
    type: "Feature",
    geometry: { type: "Polygon", coordinates: [[[-111.9, 33.4], [-111.7, 33.4], [-111.7, 33.6], [-111.9, 33.6], [-111.9, 33.4]]] },
    properties: {
      "@id": `https://api.weather.gov/alerts/${id}`,
      id,
      event: "Flood Warning",
      headline: "Flood Warning issued",
      description: "Flooding caused by upstream dam release continues.",
      instruction: null,
      severity: "Severe",
      certainty: "Likely",
      urgency: "Expected",
      sent: iso(0),
      effective: iso(0),
      onset: null,
      expires: ends,
      ends,
      areaDesc: "Maricopa, AZ",
      senderName: "NWS Phoenix AZ",
      messageType,
      status: "Actual",
      parameters: { VTEC: [vtec] },
      references: [],
    },
  });

  it("updates and reissues of one warning update a single event", async () => {
    const repo = new MemoryEventRepository(null);
    const ctx = { now: NOW, retrievedAt: iso(0) };
    const v1 = "/O.NEW.KPSR.FL.W.0012.261004T1200Z-261005T0300Z/";
    const day1 = parseNwsAlerts({ type: "FeatureCollection", features: [alert("urn:a", v1, iso(-15 * 3_600_000), "Alert")] }, ctx).candidates;
    await ingestCandidates(repo, day1, opts);
    // Update with a new message id but the same tracking number (no references).
    const upd = parseNwsAlerts({ type: "FeatureCollection", features: [alert("urn:b", v1.replace("NEW", "EXT"), iso(-20 * 3_600_000))] }, ctx).candidates;
    await ingestCandidates(repo, upd, opts);
    // Next day: reissued under a new tracking number for the same polygon.
    const next = parseNwsAlerts({ type: "FeatureCollection", features: [alert("urn:c", "/O.NEW.KPSR.FL.W.0013.261005T0400Z-261006T0300Z/", iso(-40 * 3_600_000), "Alert")] }, ctx).candidates;
    await ingestCandidates(repo, next, opts);
    expect(await repo.count()).toBe(1);
    const [e] = (await repo.query({})).events;
    expect(e.resolvedAt).toBe(iso(-40 * 3_600_000));
    expect(e.sources).toHaveLength(1);
    expect(e.sourceCount).toBe(2);
  });
});

describe("MeteoAlarm series", () => {
  const warn = (id: string, onset: string, expires: string): MeteoAlarmRaw["countries"][number]["warnings"][number] => ({
    alert: {
      identifier: id,
      sent: iso(0),
      info: [
        {
          language: "en-GB",
          event: "Orange rain warning",
          senderName: "AEMET",
          severity: "Severe",
          onset,
          expires,
          parameter: [
            { valueName: "awareness_level", value: "3; orange; Severe" },
            { valueName: "awareness_type", value: "10; Rain" },
          ],
          area: [{ areaDesc: "Oeste de La Palma" }],
        },
      ],
    },
  });

  it("merges consecutive time slices into one event spanning the period", async () => {
    const repo = new MemoryEventRepository(null);
    const ctx = { now: NOW, retrievedAt: iso(0) };
    const raw: MeteoAlarmRaw = {
      countries: [{ slug: "spain", iso2: "ES", warnings: [warn("A1", iso(-1 * 3_600_000), iso(-4 * 3_600_000)), warn("A2", iso(-4 * 3_600_000), iso(-22 * 3_600_000)), warn("A3", iso(-1 * 3_600_000), iso(-4 * 3_600_000))] }],
    };
    const { candidates } = parseMeteoAlarm(raw, ctx);
    expect(candidates).toHaveLength(3);
    await ingestCandidates(repo, candidates, opts);
    expect(await repo.count()).toBe(1);
    const [e] = (await repo.query({})).events;
    expect(e.timestamp).toBe(iso(-1 * 3_600_000));
    expect(e.resolvedAt).toBe(iso(-22 * 3_600_000));
    // Re-polling the same slices changes nothing.
    const again = await ingestCandidates(repo, candidates, opts);
    expect(again.unchanged).toBe(3);
  });
});

describe("cross-source story merge", () => {
  it("merges the same headline from another feed even when categorised differently", async () => {
    const repo = new MemoryEventRepository(null);
    const head = "India in final stage talks to expand BrahMos missile sale to Philippines";
    const rss: EventCandidateInput = candidate({
      type: "CONFLICT",
      title: head,
      latitude: 22.69,
      longitude: 79.36,
      country: "IN",
      geoPrecision: "country",
      source: source({ id: "news-rss:r:1", dataSourceId: "news-rss", externalId: "r:1", sourceName: "Reuters", sourceUrl: "https://reuters.example/x", title: head, sourceType: "NEWS_MEDIA", assertion: "MEDIA_REPORT" }),
    });
    const gkg: EventCandidateInput = candidate({
      type: "POLITICS",
      title: `${head} - sources say`,
      latitude: 23.1,
      longitude: 78.9,
      geoPrecision: "country",
      timestamp: iso(90 * 60_000),
      source: source({ id: "gdelt-gkg:z", dataSourceId: "gdelt-gkg", externalId: "z", sourceName: "times.example", sourceUrl: "https://times.example/y", title: `${head}, sources say`, sourceType: "NEWS_MEDIA", assertion: "MEDIA_REPORT" }),
    });
    await ingestCandidates(repo, [rss], opts);
    const r = await ingestCandidates(repo, [gkg], opts);
    expect(r.deduplicated).toBe(1);
    const [e] = (await repo.query({})).events;
    expect(e.outletCount).toBe(2);
    expect(normalizeHeadline("Brazil’s AI bill — and news copyright!")).toBe("brazil s ai bill and news copyright");
  });
});

describe("GDELT slots", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("plans the new slots and earlier fallbacks", () => {
    const latest = Date.UTC(2026, 10, 12, 12, 30);
    const plan = slotPlan(latest, latest + 60_000, { backfill: 4, max: 4 });
    expect(plan.primary).toEqual([latest]);
    expect(plan.fallback).toEqual([latest - SLOT_MS, latest - 2 * SLOT_MS]);
  });
  it("uses the previous slot when the latest file is not published yet", async () => {
    const latest = Date.UTC(2026, 10, 12, 12, 30);
    vi.stubGlobal("fetch", async (url: string) => (url.endsWith("123000.x") ? new Response("", { status: 404 }) : new Response(new Uint8Array([1]))));
    const ctx = { signal: new AbortController().signal, userAgent: "WorldView test", lastSuccessAt: null, now: latest, env: {} };
    const urlFor = (t: number) => `https://data.example/${new Date(t).toISOString().replace(/[-:T]/g, "").slice(0, 14)}.x`;
    const files = await fetchSlots({ primary: [latest], fallback: [latest - SLOT_MS] }, urlFor, (_b, url) => url, ctx, "test");
    expect(files).toEqual([urlFor(latest - SLOT_MS)]);
    vi.stubGlobal("fetch", async () => new Response("", { status: 404 }));
    await expect(fetchSlots({ primary: [latest], fallback: [latest - SLOT_MS] }, urlFor, (_b, url) => url, ctx, "test")).rejects.toThrow(/No test files/);
  });
});
