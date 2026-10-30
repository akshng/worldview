import { describe, expect, it } from "vitest";
import { EventCandidateSchema } from "@/types/events";
import { getConnector } from "@/data-sources/registry";
import { parseFeedXml } from "@/data-sources/news-rss/client";
import { parseAgencyFeeds } from "@/data-sources/agency-feeds/common";
import { cisaSpec, cisaSubtype, cveIds } from "@/data-sources/cisa-advisories";
import { emaSpec, emaSubtype } from "@/data-sources/ema-medicines";
import { femaCategory, femaTitleCase, parseFema, type FemaDeclarationRow } from "@/data-sources/fema-declarations";
import { parseGvp, parseGvpTitle, parseGvpXml } from "@/data-sources/gvp-volcano";
import { parseSwpc, parseSwpcMessage } from "@/data-sources/swpc-alerts";
import { CENTRAL_BANKS, classifyRelease, parseCentralBanks } from "@/data-sources/central-banks";
import { routeQuestion } from "@/lib/analyst/router";

const now = Date.parse("2026-10-30T18:00:00Z");
const ctx = { now, retrievedAt: new Date(now).toISOString() };
const valid = (xs: unknown[]) => xs.every((x) => EventCandidateSchema.safeParse(x).success);
const rss = (items: string, ns = "") => `<?xml version="1.0"?><rss version="2.0"${ns}><channel><title>x</title>${items}</channel></rss>`;
const item = (title: string, link: string, date: string, desc = "", extra = "") =>
  `<item><title>${title}</title><link>${link}</link><description>${desc}</description><pubDate>${date}</pubDate>${extra}</item>`;

describe("registry (batch 4)", () => {
  it("registers the new connectors as live", () => {
    for (const id of ["cisa-advisories", "fema-declarations", "gvp-volcano", "swpc-alerts", "ema-medicines"]) {
      const c = getConnector(id);
      expect(c, id).toBeDefined();
      expect(c!.mode).toBe("live");
      expect(c!.refreshIntervalMs).toBeGreaterThanOrEqual(10 * 60_000);
    }
  });
});

describe("cisa-advisories", () => {
  const xml = rss(
    item("Siemens SIMATIC S7-1500 CPUs", "https://www.cisa.gov/news-events/ics-advisories/icsa-26-302-03", "Thu, 29 Oct 2026 12:00:00 +0000", "CVE-2026-1234 and CVE-2026-5678 affect firmware.") +
      item("CISA Adds Two Known Exploited Vulnerabilities to Catalog", "https://www.cisa.gov/news-events/alerts/2026/10/28/cisa-adds-two-known-exploited-vulnerabilities-catalog", "Wed, 28 Oct 2026 12:00:00 +0000", "CVE-2026-9999 Example RCE") +
      item("#StopRansomware: Example Group", "https://www.cisa.gov/news-events/cybersecurity-advisories/aa26-300a", "Tue, 27 Oct 2026 12:00:00 +0000") +
      item("Old advisory", "https://www.cisa.gov/news-events/ics-advisories/icsa-26-100-01", "Tue, 01 Sep 2026 12:00:00 +0000"),
  );
  it("classifies by product type and extracts CVEs", () => {
    const r = parseAgencyFeeds(cisaSpec, { feeds: [{ feed: "advisories", items: parseFeedXml(xml) }] }, ctx);
    expect(r.candidates).toHaveLength(3);
    expect(r.skipped).toBe(1);
    expect(valid(r.candidates)).toBe(true);
    const [ics, kev, aa] = r.candidates;
    expect(ics.subtype).toBe("ICS advisory");
    expect(ics.metrics?.advisory_id).toBe("ICSA-26-302-03");
    expect(ics.metrics?.cve_count).toBe(2);
    expect(ics.title).toBe("CISA: Siemens SIMATIC S7-1500 CPUs");
    expect(kev.subtype).toBe("KEV addition");
    expect(kev.title).toBe("CISA Adds Two Known Exploited Vulnerabilities to Catalog");
    expect(aa.subtype).toBe("cybersecurity advisory");
    expect(aa.metrics?.advisory_id).toBe("AA26-300A");
    expect(ics.type).toBe("TECHNOLOGY");
    expect(ics.country).toBe("US");
  });
  it("helpers", () => {
    expect(cveIds("cve-2026-1 CVE-2026-12345 CVE-2026-12345")).toEqual(["CVE-2026-12345"]);
    expect(cisaSubtype({ title: "x", link: "https://www.cisa.gov/news-events/ics-medical-advisories/icsma-26-1-01" })).toBe("ICS medical advisory");
  });
});

describe("ema-medicines", () => {
  it("classifies and places at Amsterdam unless a country is named", () => {
    const xml = rss(
      item("Meeting highlights from the Committee for Medicinal Products for Human Use (CHMP) 20-23 October 2026", "https://www.ema.europa.eu/en/news/meeting-highlights-chmp-20-23-october-2026", "Fri, 23 Oct 2026 12:00:00 +0200") +
        item("EMA starts safety review of example medicine", "https://www.ema.europa.eu/en/news/ema-starts-safety-review", "Thu, 29 Oct 2026 10:00:00 +0100"),
    );
    const r = parseAgencyFeeds(emaSpec, { feeds: [{ feed: "news", items: parseFeedXml(xml) }] }, ctx);
    expect(r.candidates).toHaveLength(2);
    expect(valid(r.candidates)).toBe(true);
    expect(r.candidates[0].subtype).toBe("committee highlights");
    expect(r.candidates[1].subtype).toBe("safety review");
    expect(r.candidates[1].country).toBe("NL");
    expect(r.candidates[1].type).toBe("HEALTH");
  });
  it("subtypes", () => {
    expect(emaSubtype("Shortage of example antibiotic")).toBe("medicine shortage");
    expect(emaSubtype("New medicine recommended for approval")).toBe("medicine approval");
    expect(emaSubtype("EMA annual report published")).toBe("medicines news");
  });
});

describe("fema-declarations", () => {
  const base: FemaDeclarationRow = {
    femaDeclarationString: "DR-4890-FL",
    disasterNumber: 4890,
    state: "FL",
    declarationType: "DR",
    declarationDate: "2026-10-25T00:00:00.000Z",
    incidentType: "Hurricane",
    declarationTitle: "HURRICANE EXAMPLE",
    incidentBeginDate: "2026-10-18T00:00:00.000Z",
    iaProgramDeclared: true,
    paProgramDeclared: true,
    hmProgramDeclared: true,
  };
  it("groups designated areas into one event per declaration at the state", () => {
    const rows: FemaDeclarationRow[] = [
      { ...base, designatedArea: "Lee (County)" },
      { ...base, designatedArea: "Collier (County)" },
      { ...base, femaDeclarationString: "FM-5600-CA", disasterNumber: 5600, state: "CA", declarationType: "FM", incidentType: "Fire", declarationTitle: "EXAMPLE FIRE", designatedArea: "Ventura (County)", iaProgramDeclared: false, paProgramDeclared: false },
      { ...base, femaDeclarationString: "DR-4000-TX", declarationDate: "2026-08-01T00:00:00.000Z" },
      { ...base, femaDeclarationString: "DR-4001-ZZ", state: "ZZ" },
    ];
    const r = parseFema({ rows }, ctx);
    expect(r.candidates).toHaveLength(2);
    expect(r.skipped).toBe(2);
    expect(valid(r.candidates)).toBe(true);
    const [fl, ca] = r.candidates;
    expect(fl.title).toBe("Florida: Hurricane Example (FEMA DR-4890-FL)");
    expect(fl.type).toBe("WEATHER");
    expect(fl.geoPrecision).toBe("region");
    expect(fl.metrics?.designated_areas).toBe(2);
    expect(fl.summary).toContain("Individual Assistance");
    expect(fl.source.sourceUrl).toBe("https://www.fema.gov/disaster/4890");
    expect(ca.type).toBe("FIRE");
    expect(ca.subtype).toBe("FEMA Fire Management Assistance Declaration — Fire");
  });
  it("helpers", () => {
    expect(femaTitleCase("SEVERE STORMS, STRAIGHT-LINE WINDS, AND FLOODING")).toBe("Severe Storms, Straight-Line Winds, and Flooding");
    expect(femaCategory("Flood")).toBe("FLOOD");
    expect(femaCategory("Severe Ice Storm")).toBe("WEATHER");
    expect(femaCategory("Biological")).toBe("HEALTH");
    expect(femaCategory("Other")).toBe("DISASTER");
  });
});

describe("gvp-volcano", () => {
  const xml = rss(
    item("Etna (Italy) - Report for 21 October-27 October 2026 - NEW ACTIVITY/UNREST", "https://volcano.si.edu/volcano.cfm?vn=211060", "Wed, 28 Oct 2026 12:00:00 EST", "<p>INGV reported Strombolian activity.</p>", "<georss:point>37.748 14.999</georss:point>") +
      item("Sakurajima (Japan) - Report for 21 October-27 October 2026", "https://volcano.si.edu/volcano.cfm?vn=282080", "Wed, 28 Oct 2026 12:00:00 EST", "JMA reported eruptions.") +
      item("Weekly report intro", "https://volcano.si.edu/reports_weekly.cfm", "Wed, 28 Oct 2026 12:00:00 EST") +
      item("Kilauea (United States) - Report for 1 September-7 September 2026", "https://volcano.si.edu/volcano.cfm?vn=332010", "Wed, 09 Sep 2026 12:00:00 EST"),
    ' xmlns:georss="http://www.georss.org/georss"',
  );
  it("reads georss points and falls back to the country", () => {
    const items = parseGvpXml(xml);
    expect(items[0].lat).toBeCloseTo(37.748);
    expect(items[1].lat).toBeNull();
    const r = parseGvp({ items }, ctx);
    expect(r.candidates).toHaveLength(2);
    expect(r.skipped).toBe(2);
    expect(valid(r.candidates)).toBe(true);
    const [etna, saku] = r.candidates;
    expect(etna.geoPrecision).toBe("exact");
    expect(etna.subtype).toBe("weekly report — new activity/unrest");
    expect(etna.metrics?.volcano_number).toBe("211060");
    expect(etna.country).toBe("IT");
    expect(saku.geoPrecision).toBe("country");
    expect(saku.country).toBe("JP");
    expect(saku.subtype).toBe("weekly report — ongoing activity");
  });
  it("parses titles", () => {
    expect(parseGvpTitle("Etna (Italy) - Report for 21 October-27 October 2026")).toEqual({ volcano: "Etna", country: "Italy", period: "21 October-27 October 2026", status: null });
    expect(parseGvpTitle("No parentheses here")).toBeNull();
  });
});

describe("swpc-alerts", () => {
  const msg = (code: string, serial: number, head: string, scale?: string) =>
    `Space Weather Message Code: ${code}\r\nSerial Number: ${serial}\r\nIssue Time: 2026 Oct 30 1200 UTC\r\n\r\n${head}\r\n${scale ? `NOAA Scale: ${scale}\r\n` : ""}\r\nPotential Impacts: example`;
  it("keeps only significant scale levels", () => {
    const alerts = [
      { product_id: "K07A", issue_datetime: "2026-10-30 12:00:00.000", message: msg("ALTK07", 100, "ALERT: Geomagnetic K-index of 7", "G3 - Strong") },
      { product_id: "K05W", issue_datetime: "2026-10-30 11:00:00.000", message: msg("WARK05", 101, "WARNING: Geomagnetic K-index of 5 expected", "G1 - Minor") },
      { product_id: "XMF", issue_datetime: "2026-10-30 10:00:00.000", message: msg("SUMXM5", 102, "SUMMARY: X-ray Event exceeded X1", "R3 - Strong") },
      { product_id: "A30F", issue_datetime: "2026-10-30 09:00:00.000", message: msg("WATA30", 103, "WATCH: Geomagnetic Storm Category G2 Predicted") },
      { product_id: "K07A", issue_datetime: "2026-10-30 12:00:00.000", message: msg("ALTK07", 100, "ALERT: Geomagnetic K-index of 7", "G3 - Strong") },
      { product_id: "EF3A", issue_datetime: "2026-10-30 08:00:00.000", message: msg("ALTEF3", 104, "ALERT: Electron 2MeV Integral Flux exceeded 1000pfu") },
      { product_id: "K07A", issue_datetime: "2026-10-20 12:00:00.000", message: msg("ALTK07", 90, "ALERT: Geomagnetic K-index of 7", "G3 - Strong") },
    ];
    const r = parseSwpc({ alerts }, ctx);
    expect(r.candidates.map((c) => c.metrics?.noaa_scale)).toEqual(["G3", "R3", "G2"]);
    expect(r.skipped).toBe(4);
    expect(valid(r.candidates)).toBe(true);
    expect(r.candidates[0].title).toBe("NOAA SWPC alert: Geomagnetic K-index of 7 (G3 Strong)");
    expect(r.candidates[0].timestamp).toBe("2026-10-30T12:00:00.000Z");
    expect(r.candidates[2].source.assertion).toBe("OFFICIAL_PRELIMINARY");
  });
  it("parses message headers", () => {
    expect(parseSwpcMessage("CANCEL WARNING: Geomagnetic K-index of 4\nSerial Number: 5")?.kind).toBe("CANCEL");
    expect(parseSwpcMessage("no header")).toBeNull();
  });
});

describe("central-banks (RBA, RBI)", () => {
  const rba = CENTRAL_BANKS.find((b) => b.id === "rba")!;
  const rbi = CENTRAL_BANKS.find((b) => b.id === "rbi")!;
  it("recognises rate decisions", () => {
    expect(classifyRelease(rba, "Statement by the Monetary Policy Board: Monetary Policy Decision")).toBe("rate decision");
    expect(classifyRelease(rbi, "Resolution of the Monetary Policy Committee (MPC) October 1, 2026")).toBe("rate decision");
  });
  it("skips routine RBI notices", () => {
    const xml = rss(
      item("RBI imposes monetary penalty on Example Co-operative Bank Ltd.", "https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=1", "Thu, 29 Oct 2026 18:00:00 +0530") +
        item("Money Market Operations as on October 28, 2026", "https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=2", "Thu, 29 Oct 2026 18:00:00 +0530") +
        item("Governor's Statement: October 1, 2026", "https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=3", "Thu, 29 Oct 2026 18:00:00 +0530"),
    );
    const r = parseCentralBanks({ feeds: [{ bank: "rbi", items: parseFeedXml(xml) }] }, ctx);
    expect(r.candidates).toHaveLength(1);
    expect(r.candidates[0].country).toBe("IN");
    expect(r.candidates[0].title).toBe("Reserve Bank of India: Governor's Statement: October 1, 2026");
  });
});

describe("analyst routing (batch 4)", () => {
  const sources = (q: string) => routeQuestion(q, { watchlist: [] }).map((c) => (c.args as { source?: string }).source).filter(Boolean);
  it("routes to the new sources", () => {
    expect(sources("any FEMA disaster declarations this month?")).toContain("fema-declarations");
    expect(sources("is there a geomagnetic storm tonight, northern lights?")).toContain("swpc-alerts");
    expect(sources("latest CISA ICS advisories")).toContain("cisa-advisories");
    expect(sources("what did the European Medicines Agency say")).toContain("ema-medicines");
    expect(sources("which volcanoes are erupting")).toContain("gvp-volcano");
  });
  it("does not confuse trading terms with the new sources", () => {
    expect(sources("is NVDA above its 50-day EMA")).not.toContain("ema-medicines");
    expect(sources("CME gold futures open interest")).not.toContain("swpc-alerts");
  });
});
