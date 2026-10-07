import { describe, expect, it } from "vitest";
import { EventCandidateSchema } from "@/types/events";
import { describeFcdoStatus, parseFcdoTravel, recentFcdoChildren, toFcdoPage } from "@/data-sources/fcdo-travel";
import { parseCanadaTravel } from "@/data-sources/canada-travel";
import { parseSmartraveller, parseSmartravellerChanged, sydneyOffsetHours } from "@/data-sources/smartraveller";
import { matchScore } from "@/lib/deduplication/similarity";

const now = Date.parse("2026-10-06T12:00:00Z");
const ctx = { now, retrievedAt: new Date(now).toISOString() };
const valid = (xs: unknown[]) => xs.every((x) => EventCandidateSchema.safeParse(x).success);
const daysAgo = (d: number) => new Date(now - d * 86_400_000).toISOString();

describe("UK FCDO travel advice", () => {
  const doc = (slug: string, name: string, days: number, alert_status: string[]) => ({
    base_path: `/foreign-travel-advice/${slug}`,
    title: `${name} travel advice`,
    web_url: `https://www.gov.uk/foreign-travel-advice/${slug}`,
    public_updated_at: daysAgo(days),
    details: { alert_status, change_description: "Updated information about regional tensions (‘Warnings and insurance’ page).", country: { name, slug } },
  });

  it("selects recently updated destinations from the index", () => {
    const index = { links: { children: [doc("saudi-arabia", "Saudi Arabia", 1, []), doc("france", "France", 45, []), doc("peru", "Peru", 3, [])] } };
    expect(recentFcdoChildren(index, now).map((c) => c.details?.country?.slug)).toEqual(["saudi-arabia", "peru"]);
  });

  it("maps alert_status to advice and supersedes other statuses", () => {
    const pages = [
      doc("saudi-arabia", "Saudi Arabia", 1, ["avoid_all_travel_to_parts", "avoid_all_but_essential_travel_to_parts"]),
      doc("afghanistan", "Afghanistan", 2, ["avoid_all_travel_to_whole_country"]),
      doc("italy", "Italy", 2, []),
      doc("mali", "Mali", 60, ["avoid_all_travel_to_whole_country"]),
    ].map((d) => toFcdoPage(d)!);
    const r = parseFcdoTravel({ pages }, ctx);
    expect(r.candidates.map((c) => c.country)).toEqual(["SA", "AF"]);
    expect(r.skipped).toBe(2);
    expect(r.candidates[0].title).toBe("UK travel advice: Saudi Arabia — FCDO advises against all travel to parts");
    expect(r.candidates[0].summary).toContain("against all travel or all but essential travel to parts of Saudi Arabia");
    expect(r.candidates[0].source).toMatchObject({ id: "fcdo-travel:saudi-arabia:avoid_all_travel_to_parts", assertion: "OFFICIAL_FINAL", sourceUrl: "https://www.gov.uk/foreign-travel-advice/saudi-arabia" });
    expect(r.candidates[0].supersedes).toContain("fcdo-travel:saudi-arabia:avoid_all_travel_to_whole_country");
    expect(r.candidates[0].supersedes).not.toContain("fcdo-travel:saudi-arabia:avoid_all_travel_to_parts");
    expect(r.candidates[1]).toMatchObject({ geoPrecision: "country", subtype: "travel advisory" });
    expect(valid(r.candidates)).toBe(true);
  });

  it("describes combined statuses", () => {
    expect(describeFcdoStatus("X", ["avoid_all_but_essential_travel_to_whole_country", "avoid_all_travel_to_parts"])).toBe(
      "The FCDO advises against all but essential travel to X; and against all travel to parts of X",
    );
    expect(describeFcdoStatus("X", [])).toBeNull();
  });
});

describe("Canada travel advisories", () => {
  const entry = (iso: string, name: string, state: number, days: number) => ({
    "country-iso": iso,
    "country-eng": name,
    "advisory-state": state,
    "date-published": { timestamp: Math.floor((now - days * 86_400_000) / 1000), date: "x" },
    "has-regional-advisory": 0,
    "recent-updates-type": "Editorial change",
    eng: { name, "url-slug": name.toLowerCase(), "advisory-text": state === 3 ? "Avoid all travel" : state === 2 ? "Avoid non-essential travel" : "Exercise a high degree of caution", "recent-updates": "The Safety and security section was updated." },
  });

  it("keeps recent state 2–3 advisories with level supersedes", () => {
    const r = parseCanadaTravel({ data: { AF: entry("AF", "Afghanistan", 3, 5), BH: entry("BH", "Bahrain", 2, 2), FR: entry("FR", "France", 1, 1), ML: entry("ML", "Mali", 3, 40) } }, ctx);
    expect(r.candidates.map((c) => c.country)).toEqual(["AF", "BH"]);
    expect(r.candidates[0]).toMatchObject({ title: "Canada travel advisory: Afghanistan — Avoid all travel", metrics: { advisory_state: 3 } });
    expect(r.candidates[0].source.sourceUrl).toBe("https://travel.gc.ca/destinations/afghanistan");
    expect(r.candidates[0].supersedes).toEqual(["canada-travel:AF:0", "canada-travel:AF:1", "canada-travel:AF:2"]);
    expect(r.candidates[0].description).toContain("editorial change");
    expect(valid(r.candidates)).toBe(true);
  });
});

describe("Australia Smartraveller", () => {
  it("parses Sydney local times across daylight saving", () => {
    expect(sydneyOffsetHours(2026, 7, 1, 12)).toBe(10);
    expect(sydneyOffsetHours(2026, 10, 7, 10)).toBe(11); // first Sunday of Oct 2026 is the 4th
    expect(sydneyOffsetHours(2026, 10, 3, 10)).toBe(10);
    expect(parseSmartravellerChanged("Wed, 2026-10-07 10:33")?.toISOString()).toBe("2026-10-06T23:33:00.000Z");
    expect(parseSmartravellerChanged("garbage")).toBeNull();
  });

  it("keeps recent level 3–4 destinations", () => {
    const d = (title: string, level: string, changed: string) => ({ title, field_overall_advice_level: level, field_last_update: "<p>We continue to advise <b>do not travel</b>.</p>", field_url: `https://www.smartraveller.gov.au/destinations/x/${title.toLowerCase()}`, changed });
    const r = parseSmartraveller(
      { destinations: [d("Afghanistan", "Do not travel", "Mon, 2026-10-05 09:00"), d("Bahrain", "Reconsider your need to travel", "Thu, 2026-10-01 16:54"), d("Japan", "Exercise normal safety precautions", "Mon, 2026-10-05 09:00"), d("Mali", "Do not travel", "Mon, 2026-06-01 09:00")] },
      ctx,
    );
    expect(r.candidates.map((c) => c.country)).toEqual(["AF", "BH"]);
    expect(r.candidates[0]).toMatchObject({ title: "Australia travel advice: Afghanistan — Level 4, do not travel", metrics: { advisory_level: 4 }, description: "We continue to advise do not travel." });
    expect(r.candidates[1].supersedes).toContain("smartraveller:bahrain:4");
    expect(valid(r.candidates)).toBe(true);
  });
});

describe("travel advisory dedup", () => {
  it("never merges two governments' advisories", () => {
    const base = { type: "POLITICS" as const, subtype: "travel advisory", latitude: 24, longitude: 45, timestamp: daysAgo(1), entities: [], metrics: {} };
    const us = { ...base, title: "US travel advisory: Saudi Arabia — Level 3, reconsider travel", dataSourceIds: ["travel-advisories"] };
    const uk = { ...base, title: "UK travel advice: Saudi Arabia — FCDO advises against all travel to parts", dataSourceIds: ["fcdo-travel"] };
    expect(matchScore(us, uk, { mergeWithinSource: new Set() })).toBeNull();
  });
});
