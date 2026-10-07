import { describe, expect, it } from "vitest";
import { EventCandidateSchema } from "@/types/events";
import { describeFcdoStatus, parseFcdoTravel, recentFcdoChildren, toFcdoPage } from "@/data-sources/fcdo-travel";
import { parseCanadaTravel } from "@/data-sources/canada-travel";
import { parseSmartraveller, parseSmartravellerChanged, sydneyOffsetHours } from "@/data-sources/smartraveller";
import { matchScore } from "@/lib/deduplication/similarity";
import { parseTravelAdvisories } from "@/data-sources/travel-advisories";
import { advisoryChanges, nvdUrl, parseKev, parseNvd } from "@/lib/cyber";

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

describe("CISA KEV", () => {
  const row = (cveID: string, dateAdded: string, ransom = "Unknown") => ({
    cveID,
    vendorProject: "Citrix",
    product: "NetScaler",
    vulnerabilityName: "Citrix NetScaler Memory Buffer Vulnerability",
    shortDescription: "Citrix NetScaler ADC contains a buffer vulnerability.",
    dateAdded,
    dueDate: "2026-10-07",
    knownRansomwareCampaignUse: ransom,
  });

  it("summarises recent additions newest first", () => {
    const { summary, ids } = parseKev(
      { catalogVersion: "2026.10.04", dateReleased: "2026-10-04T18:52:56Z", vulnerabilities: [row("CVE-2026-1111", "2026-09-01"), row("CVE-2026-88779", "2026-10-04", "Known"), row("CVE-2026-2222", "2026-10-02"), row("bogus", "2026-10-04")] },
      now,
    );
    expect(summary).toMatchObject({ total: 3, addedLast7d: 2, addedLast30d: 2, catalogVersion: "2026.10.04" });
    expect(summary.latest.map((v) => v.cveId)).toEqual(["CVE-2026-88779", "CVE-2026-2222", "CVE-2026-1111"]);
    expect(summary.latest[0]).toMatchObject({ ransomware: true, vendor: "Citrix", dueDate: "2026-10-07", url: "https://nvd.nist.gov/vuln/detail/CVE-2026-88779" });
    expect(summary.latest[1].ransomware).toBe(false);
    expect(ids.has("CVE-2026-1111")).toBe(true);
  });
});

describe("NVD CVE API", () => {
  const cve = (id: string, published: string, metrics: object, vulnStatus = "Analyzed") => ({
    cve: {
      id,
      published,
      vulnStatus,
      descriptions: [{ lang: "es", value: "x" }, { lang: "en", value: "A code injection   vulnerability in WatchGuard Fireware OS." }],
      affected: [{ affectedData: [{ vendor: "WatchGuard", product: "Fireware OS" }] }],
      metrics,
    },
  });
  const v31 = (type: string, baseScore: number, baseSeverity: string) => ({ type, cvssData: { baseScore, baseSeverity, vectorString: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H" } });

  it("prefers the primary CVSS v3 score and sorts newest first", () => {
    const r = parseNvd({
      vulnerabilities: [
        cve("CVE-2026-86131", "2026-09-30T00:16:36.817", { cvssMetricV31: [v31("Secondary", 7.7, "HIGH"), v31("Primary", 9.8, "CRITICAL")] }),
        cve("CVE-2026-104070", "2026-10-06T17:17:12.213", { cvssMetricV31: [v31("Primary", 9.1, "CRITICAL")] }),
        cve("CVE-2026-9999", "2026-10-06T17:17:12.213", { cvssMetricV31: [v31("Primary", 9.1, "CRITICAL")] }, "Rejected"),
        cve("CVE-2026-10000", "2026-10-06T17:17:12.213", {}),
      ],
    });
    expect(r.map((c) => c.id)).toEqual(["CVE-2026-104070", "CVE-2026-86131"]);
    expect(r[1]).toMatchObject({ score: 9.8, severity: "CRITICAL", vendor: "WatchGuard", product: "Fireware OS", published: "2026-09-30T00:16:36.817Z", knownExploited: false });
    expect(r[1].description).toBe("A code injection vulnerability in WatchGuard Fireware OS.");
  });

  it("builds a bounded critical-severity query", () => {
    const u = new URL(nvdUrl(now, 7));
    expect(u.searchParams.get("cvssV3Severity")).toBe("CRITICAL");
    expect(u.searchParams.get("pubStartDate")).toBe("2026-09-29T12:00:00.000Z");
    expect(u.searchParams.get("pubEndDate")).toBe("2026-10-06T12:00:00.000Z");
  });
});

describe("advisory changes", () => {
  it("turns advisory candidates from every government into panel rows", () => {
    const ca = parseCanadaTravel(
      { data: { LY: { "country-iso": "LY", "advisory-state": 3, "date-published": { timestamp: Math.floor((now - 86_400_000) / 1000) }, eng: { name: "Libya", "url-slug": "libya", "advisory-text": "Avoid all travel" } } } },
      ctx,
    ).candidates;
    const us = parseTravelAdvisories({ items: [{ title: "Saudi Arabia - Level 3: Reconsider Travel", link: "https://travel.state.gov/sa", description: "", published: daysAgo(3) }] }, ctx).candidates;
    expect(advisoryChanges([...us, ...ca])).toEqual([
      { government: "CA", country: "LY", place: "Libya", advice: "Avoid all travel", updatedAt: daysAgo(1), url: "https://travel.gc.ca/destinations/libya" },
      { government: "US", country: "SA", place: "Saudi Arabia", advice: "Level 3, reconsider travel", updatedAt: daysAgo(3), url: "https://travel.state.gov/sa" },
    ]);
  });
});
