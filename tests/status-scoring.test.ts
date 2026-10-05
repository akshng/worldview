import { describe, expect, it } from "vitest";
import { deriveConfidence, deriveStatus, independentPublisherCount } from "@/lib/events/status";
import { calculateImportance, severityOf } from "@/lib/scoring/importance";
import { importanceLevel } from "@/lib/categories";
import { NOW, source, iso } from "./helpers";

const media = (host: string, i: number) =>
  source({ id: `gdelt:${i}`, dataSourceId: "gdelt", externalId: String(i), sourceName: host, sourceUrl: `https://${host}/story-${i}`, sourceType: "NEWS_MEDIA", assertion: "MEDIA_REPORT" });

describe("status derivation", () => {
  it("never confirms from media reports alone", () => {
    expect(deriveStatus([media("a.com", 1)], null, NOW)).toBe("UNVERIFIED");
    expect(deriveStatus([media("a.com", 1), media("b.com", 2), media("c.com", 3)], null, NOW)).toBe("REPORTED");
  });

  it("counts the same publisher once", () => {
    const s = [media("a.com", 1), media("www.a.com", 2)];
    expect(independentPublisherCount(s)).toBe(1);
    expect(deriveStatus(s, null, NOW)).toBe("UNVERIFIED");
  });

  it("confirms only with an official final record", () => {
    expect(deriveStatus([source({ assertion: "OFFICIAL_FINAL" })], null, NOW)).toBe("CONFIRMED");
    expect(deriveStatus([source({ assertion: "OFFICIAL_PRELIMINARY" })], null, NOW)).toBe("REPORTED");
    expect(deriveStatus([source({ assertion: "OFFICIAL_PRELIMINARY" }), media("b.com", 2)], null, NOW)).toBe("PARTIALLY_CONFIRMED");
  });

  it("resolves when the end time has passed, not before", () => {
    expect(deriveStatus([source()], iso(1000), NOW)).toBe("RESOLVED");
    expect(deriveStatus([source({ assertion: "OFFICIAL_PRELIMINARY" })], new Date(NOW + 3_600_000).toISOString(), NOW)).toBe("REPORTED");
  });

  it("keeps synthetic data unverified with zero confidence", () => {
    const s = [source({ sourceType: "SYNTHETIC", assertion: "SYNTHETIC", sourceUrl: null })];
    expect(deriveStatus(s, null, NOW)).toBe("UNVERIFIED");
    expect(deriveConfidence(s, "exact")).toBe(0);
  });
});

describe("importance scoring", () => {
  const base = { type: "EARTHQUAKE" as const, subtype: null, independentSources: 1, officialFinal: true, status: "CONFIRMED" as const, timestamp: iso(0) };

  it("is bounded 0–100 and monotonic in magnitude", () => {
    const m4 = calculateImportance({ ...base, metrics: { magnitude: 4 } }, NOW).score;
    const m6 = calculateImportance({ ...base, metrics: { magnitude: 6 } }, NOW).score;
    const m9 = calculateImportance({ ...base, metrics: { magnitude: 9, tsunami: true, alert_level: "red" } }, NOW).score;
    expect(m4).toBeLessThan(m6);
    expect(m6).toBeLessThan(m9);
    expect(m9).toBeLessThanOrEqual(100);
    expect(importanceLevel(m9)).toBe("CRITICAL");
  });

  it("rewards corroboration and confirmation", () => {
    const one = calculateImportance({ ...base, metrics: { magnitude: 5 }, officialFinal: false, status: "UNVERIFIED" }, NOW).score;
    const many = calculateImportance({ ...base, metrics: { magnitude: 5 }, independentSources: 6 }, NOW).score;
    expect(many).toBeGreaterThan(one);
  });

  it("decays with age", () => {
    const fresh = calculateImportance({ ...base, metrics: { magnitude: 5 } }, NOW).score;
    const old = calculateImportance({ ...base, metrics: { magnitude: 5 }, timestamp: iso(4 * 86_400_000) }, NOW).score;
    expect(old).toBeLessThan(fresh);
  });

  it("explains itself with factors that sum to the score", () => {
    const r = calculateImportance({ ...base, metrics: { magnitude: 6.5 } }, NOW);
    const sum = r.factors.reduce((s, f) => s + f.points, 0);
    expect(Math.abs(sum - r.score)).toBeLessThanOrEqual(1);
    expect(r.factors.map((f) => f.factor)).toEqual(["severity", "corroboration", "confirmation", "scale", "recency"]);
  });

  it("uses alert levels for hazards", () => {
    expect(severityOf({ type: "FLOOD", subtype: null, metrics: { alert_level: "red" } }).value).toBeGreaterThan(
      severityOf({ type: "FLOOD", subtype: null, metrics: { alert_level: "green" } }).value,
    );
  });

  it("maps score bands to levels", () => {
    expect(importanceLevel(10)).toBe("MINOR");
    expect(importanceLevel(30)).toBe("LOW");
    expect(importanceLevel(50)).toBe("MODERATE");
    expect(importanceLevel(70)).toBe("HIGH");
    expect(importanceLevel(81)).toBe("CRITICAL");
  });
});
