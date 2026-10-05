import { describe, expect, it } from "vitest";
import { findBestMatch, jaccard, matchScore, tokenize, type Comparable } from "@/lib/deduplication/similarity";
import { iso } from "./helpers";

const opts = { mergeWithinSource: new Set(["gdelt"]) };

const quake = (o: Partial<Comparable> = {}): Comparable => ({
  type: "EARTHQUAKE",
  subtype: null,
  title: "M 6.2 earthquake near Sendai",
  latitude: 38.27,
  longitude: 141.4,
  timestamp: iso(0),
  entities: [],
  metrics: { magnitude: 6.2 },
  dataSourceIds: ["usgs"],
  ...o,
});

const news = (o: Partial<Comparable> = {}): Comparable => ({
  type: "CONFLICT",
  subtype: "explosion",
  title: "Explosion at fuel depot kills workers",
  latitude: 50.45,
  longitude: 30.52,
  timestamp: iso(0),
  entities: [],
  metrics: {},
  dataSourceIds: ["gdelt"],
  ...o,
});

describe("text similarity", () => {
  it("tokenises without stopwords", () => {
    expect([...tokenize("The explosion in Kyiv, reported by AP")]).toEqual(["explosion", "kyiv"]);
  });
  it("computes jaccard", () => {
    expect(jaccard(new Set(["a", "b"]), new Set(["b", "c"]))).toBeCloseTo(1 / 3);
  });
});

describe("deduplication", () => {
  it("merges the same earthquake reported by two agencies", () => {
    const r = matchScore(quake(), quake({ title: "Green M6.1 earthquake in Japan", latitude: 38.4, longitude: 141.5, metrics: { magnitude: 6.1 }, dataSourceIds: ["gdacs"], timestamp: iso(60_000) }), opts);
    expect(r).not.toBeNull();
    expect(r!.score).toBeGreaterThan(0.55);
  });

  it("never merges two distinct quakes from the same authoritative feed", () => {
    expect(matchScore(quake(), quake({ timestamp: iso(30_000) }), opts)).toBeNull();
  });

  it("rejects quakes whose magnitudes disagree", () => {
    expect(matchScore(quake(), quake({ metrics: { magnitude: 4.5 }, dataSourceIds: ["gdacs"] }), opts)).toBeNull();
  });

  it("rejects events too far apart in space or time", () => {
    expect(matchScore(quake(), quake({ latitude: 35, dataSourceIds: ["gdacs"] }), opts)).toBeNull();
    expect(matchScore(quake(), quake({ timestamp: iso(3_600_000), dataSourceIds: ["gdacs"] }), opts)).toBeNull();
  });

  it("merges multiple outlets reporting the same explosion", () => {
    const reports = [
      news({ title: "Explosion at Kyiv fuel depot kills two workers" }),
      news({ title: "Fuel depot explosion in Kyiv: two workers killed", latitude: 50.47, timestamp: iso(40 * 60_000) }),
      news({ title: "Two killed as explosion rips through Kyiv fuel depot", longitude: 30.55, timestamp: iso(90 * 60_000) }),
    ];
    for (const r of reports.slice(1)) expect(findBestMatch(r, [reports[0]], opts)).not.toBeNull();
  });

  it("merges syndicated copies of one story even when geocoded to different cities", () => {
    const a = news({ title: "Israeli army says it killed assailant in southern Syria", latitude: 33.5, longitude: 36.3 });
    const b = news({ title: "Israeli army says it killed assailant in southern Syria", latitude: 31.77, longitude: 35.23 });
    expect(findBestMatch(b, [a], opts)).not.toBeNull();
    // …but short, generic headlines far apart stay separate
    const c = news({ title: "Explosion at fuel depot kills workers", latitude: 48.5, longitude: 35.0 });
    expect(findBestMatch(c, [news()], opts)).toBeNull();
  });

  it("keeps unrelated stories in the same city apart", () => {
    const a = news({ title: "Explosion at fuel depot kills workers" });
    const b = news({ title: "Mayor opens new metro station after delays" });
    expect(findBestMatch(b, [a], opts)).toBeNull();
  });

  it("does not merge different categories", () => {
    expect(matchScore(news(), news({ type: "PROTEST" }), opts)).toBeNull();
  });

  it("uses entity overlap as supporting evidence", () => {
    const e = [{ type: "ACTOR" as const, name: "Police", code: null }];
    const with_ = matchScore(news({ entities: e }), news({ title: "Explosion at fuel depot kills workers overnight", entities: e }), opts)!;
    const without = matchScore(news({ entities: e }), news({ title: "Explosion at fuel depot kills workers overnight", entities: [{ type: "ACTOR", name: "Army", code: null }] }), opts)!;
    expect(with_.score).toBeGreaterThan(without.score);
  });
});
