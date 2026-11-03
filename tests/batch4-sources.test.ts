import { describe, expect, it } from "vitest";
import { EventCandidateSchema } from "@/types/events";
import { getConnector } from "@/data-sources/registry";
import { parseFeedXml } from "@/data-sources/news-rss/client";
import { parseAgencyFeeds } from "@/data-sources/agency-feeds/common";
import { parseSwpc, readSwpcMessage, subsolarPoint, swpcTime } from "@/data-sources/swpc-alerts";
import { parseTfr, tfrModified } from "@/data-sources/faa-tfr";
import { parseRiver } from "@/data-sources/river-flooding";
import { parseSpcWatches, readWatchItem } from "@/data-sources/spc-watches";
import { parseGeofon } from "@/data-sources/geofon";
import { cyberSpec, cyberSubtype, normalizeZone } from "@/data-sources/cyber-advisories";
import { ukDefenceKind, ukDefenceSpec } from "@/data-sources/uk-defence";
import { femaCategory, parseFema } from "@/data-sources/fema-declarations";
import { parse13dAtom, parseSec13d, readCover, split13dSubmission } from "@/data-sources/sec-13d";

const now = Date.parse("2026-11-03T03:00:00Z");
const ctx = { now, retrievedAt: new Date(now).toISOString() };
const valid = (xs: unknown[]) => xs.every((x) => EventCandidateSchema.safeParse(x).success);

const NEW_IDS = ["swpc-alerts", "faa-tfr", "river-flooding", "spc-watches", "geofon", "cyber-advisories", "uk-defence", "fema-declarations", "sec-13d"];

describe("registry (batch 4)", () => {
  it("registers the new connectors as live with sane refresh intervals", () => {
    for (const id of NEW_IDS) {
      const c = getConnector(id);
      expect(c, id).toBeDefined();
      expect(c!.mode).toBe("live");
      expect(c!.refreshIntervalMs).toBeGreaterThanOrEqual(5 * 60_000);
    }
  });
});

describe("swpc-alerts", () => {
  const k6 =
    "Space Weather Message Code: ALTK06\r\nSerial Number: 729\r\nIssue Time: 2026 Nov 02 1914 UTC\r\n\r\nALERT: Geomagnetic K-index of 6 \nThreshold Reached: 2026 Nov 02 1914 UTC\nSynoptic Period: 1800-2100\nActive Warning: YES\nNoaa Scale: G2 - Moderate\r\n\r\nPotential Impacts: Area of impact primarily poleward of 55 degrees Geomagnetic Latitude.";
  const k6cont = "Space Weather Message Code: ALTK06\r\nSerial Number: 730\r\nIssue Time: 2026 Nov 02 2214 UTC\r\n\r\nCONTINUED ALERT: Geomagnetic K-index of 6 \nContinuation of Serial Number: 729\nNOAA Scale: G2 - Moderate";
  const xray =
    "Space Weather Message Code: SUMX01\r\nSerial Number: 12\r\nIssue Time: 2026 Nov 02 1530 UTC\r\n\r\nSUMMARY: X-ray Event exceeded X1\nBegin Time: 2026 Nov 02 1458 UTC\nMaximum Time: 2026 Nov 02 1510 UTC\nEnd Time: 2026 Nov 02 1520 UTC\nX-ray Class: X1.4\nLocation: N08W50\nNOAA Scale: R3 - Strong";
  const k4 = "Space Weather Message Code: WARK04\r\nSerial Number: 5446\r\nIssue Time: 2026 Nov 01 1457 UTC\r\n\r\nWARNING: Geomagnetic K-index of 4 expected\nValid From: 2026 Oct 31 1235 UTC";
  const watch =
    "Space Weather Message Code: WATA30\r\nSerial Number: 286\r\nIssue Time: 2026 Nov 02 1200 UTC\r\n\r\nWATCH: Geomagnetic Storm Category G2 Predicted\r\n\r\nHighest Storm Level Predicted by Day:\nNov 02:  G1 (Minor)   Nov 03:  G2 (Moderate)   Nov 04:  None (Below G1)\r\n";
  const msgs = [
    { product_id: "K06A", issue_datetime: "2026-11-02 19:14:22.467", message: k6 },
    { product_id: "K06A", issue_datetime: "2026-11-02 22:14:00.000", message: k6cont },
    { product_id: "X01S", issue_datetime: "2026-11-02 15:30:00.000", message: xray },
    { product_id: "K04W", issue_datetime: "2026-11-01 14:57:52.780", message: k4 },
    { product_id: "A30F", issue_datetime: "2026-11-02 12:00:00.000", message: watch },
    { product_id: "K06A", issue_datetime: "2026-10-20 12:00:00.000", message: k6.replace("729", "700") },
  ];
  it("reads the SWPC message fields and the NOAA scale", () => {
    const f = readSwpcMessage(k6)!;
    expect(f.code).toBe("ALTK06");
    expect(f.kind).toBe("ALERT");
    expect(f.scale).toEqual({ letter: "G", level: 2, label: "Moderate" });
    expect(readSwpcMessage(k4)!.scale).toBeNull();
    expect(readSwpcMessage(k6cont)!.previousSerial).toBe("729");
    expect(swpcTime("2026 Nov 02 1914 UTC")).toBe("2026-11-02T19:14:00.000Z");
  });
  it("keeps scaled alerts/summaries/watches, supersedes continuations, places blackouts at the subsolar point", () => {
    const r = parseSwpc({ messages: msgs }, ctx);
    expect(r.candidates).toHaveLength(4);
    expect(r.skipped).toBe(2); // K4 warning, old alert
    expect(valid(r.candidates)).toBe(true);
    const cont = r.candidates.find((c) => c.source.externalId === "ALTK06:730")!;
    expect(cont.supersedes).toEqual(["swpc-alerts:ALTK06:729"]);
    const x = r.candidates.find((c) => c.subtype === "radio blackout")!;
    expect(x.title).toContain("R3 (Strong) radio blackout");
    expect(x.timestamp).toBe("2026-11-02T15:10:00.000Z");
    const sp = subsolarPoint("2026-11-02T15:10:00.000Z");
    expect(x.latitude).toBe(sp.lat);
    expect(sp.lat).toBeLessThan(-14); // November: Sun over the southern tropics
    // Solar noon at Greenwich is ~11:44 UTC in early November (equation of time ≈ +16 min),
    // so at 15:10 UTC the Sun is overhead ~51.5° W.
    expect(sp.lon).toBeGreaterThan(-54);
    expect(sp.lon).toBeLessThan(-49);
    const w = r.candidates.find((c) => c.subtype === "geomagnetic storm watch")!;
    expect(w.source.assertion).toBe("SCHEDULED");
    expect(w.summary).toContain("Predicted by day: Nov 02: G1 (Minor); Nov 03: G2 (Moderate); Nov 04: None (Below G1).");
  });
});

describe("faa-tfr", () => {
  const square = (x: number, y: number, d = 0.05) => [[[x, y], [x + d, y], [x + d, y + d], [x, y + d], [x, y]]];
  const raw = {
    list: [
      { notam_id: "6/4857", type: "HAZARDS", facility: "ZTL", state: "GA", description: "8NM SW MONTICELLO, GA, Tuesday, November 3, 2026 UTC", creation_date: "11/02/2026" },
      { notam_id: "6/2657", type: "SECURITY", facility: "ZLA", state: "CA", description: "Calexico, CA, Saturday, July 4, 2026 through Saturday, January 2, 2027 Local", creation_date: "07/02/2026" },
      { notam_id: "6/9999", type: "VIP", facility: "ZNY", state: "NY", description: "New York, NY", creation_date: "11/02/2026" },
    ],
    features: [
      { id: "V_TFR_LOC.6/4857", geometry: { type: "Polygon", coordinates: square(-83.8, 33.2) }, properties: { NOTAM_KEY: "6/4857-1-FDC-F", LAST_MODIFICATION_DATETIME: "202611022353", LEGAL: "HAZARDS" } },
      { id: "V_TFR_LOC.6/2657", geometry: { type: "Polygon", coordinates: square(-115.5, 32.6) }, properties: { NOTAM_KEY: "6/2657-1-FDC-F", LAST_MODIFICATION_DATETIME: "202607021404", LEGAL: "SECURITY" } },
    ],
  };
  it("joins the list with the polygons and skips standing or unmapped TFRs", () => {
    expect(tfrModified("202611022353")).toBe("2026-11-02T23:53:00.000Z");
    const r = parseTfr(raw, ctx);
    expect(r.candidates).toHaveLength(1);
    expect(r.skipped).toBe(2);
    expect(valid(r.candidates)).toBe(true);
    const c = r.candidates[0];
    expect(c.type).toBe("AVIATION");
    expect(c.subtype).toBe("TFR — hazard / disaster area");
    expect(c.geometry?.type).toBe("Polygon");
    expect(c.latitude).toBeGreaterThan(33.2);
    expect(c.latitude).toBeLessThan(33.25);
    expect(c.source.sourceUrl).toBe("https://tfr.faa.gov/tfr3/?page=detail_6_4857");
  });
});

describe("river-flooding", () => {
  const gauge = (lid: string, status: string, obstime: string) => ({
    attributes: { gaugelid: lid, status, location: "Cedar Hill", waterbody: "Animas River", state: "CO", obstime, wfo: "gjt", url: "https://water.noaa.gov/gauges/cdrc2", units: "ft", flood: "10.5", moderate: "11.5", major: "12.5", observed: "13.99", secvalue: "25.6", secunit: "kcfs", latitude: 37.036569, longitude: -107.875333 },
  });
  it("emits moderate/major gauges with supersedes across categories", () => {
    const r = parseRiver({ features: [gauge("CDRC2", "major", "2026-11-03 00:45:00"), gauge("ABCD1", "minor", "2026-11-03 00:45:00"), gauge("OLDX1", "major", "2026-10-20 00:00:00")] }, ctx);
    expect(r.candidates).toHaveLength(1);
    expect(r.skipped).toBe(2);
    expect(valid(r.candidates)).toBe(true);
    const c = r.candidates[0];
    expect(c.title).toBe("Major flooding: Animas River at Cedar Hill, CO");
    expect(c.timestamp).toBe("2026-11-03T00:45:00.000Z");
    expect(c.supersedes).toEqual(["river-flooding:CDRC2:moderate"]);
    expect(c.metrics?.observed_stage).toBe(13.99);
  });
});

describe("spc-watches", () => {
  const rss = `<?xml version="1.0"?><rss version="2.0"><channel><title>SPC</title><item>
    <link>https://www.spc.noaa.gov/products/watch/ww0703.html</link><title>SPC Tornado Watch 703</title>
    <description>WW 703 TORNADO AR KS MO OK 030135Z - 030900Z
<![CDATA[<pre>
Tornado Watch Number 703

* Primary threats include...
  A couple tornadoes possible
  Scattered damaging wind gusts to 70 mph possible

SUMMARY...Clusters of thunderstorms.
</pre>]]></description><pubDate>Tue, 03 Nov 2026 01:35:04 +0000</pubDate></item></channel></rss>`;
  const county = (x: number, y: number, event = "0703") => ({
    properties: { prod_type: "Tornado Watch", phenom: "TO", event, onset: "2026-11-02T19:35:00-06:00", ends: "2026-11-03T03:00:00-06:00", wfo: "KSGF" },
    geometry: { type: "Polygon", coordinates: [[[x, y], [x + 0.3, y], [x + 0.3, y + 0.3], [x, y + 0.3], [x, y]]] },
  });
  it("reads the watch text", () => {
    const w = readWatchItem(parseFeedXml(rss)[0])!;
    expect(w.number).toBe(703);
    expect(w.states).toEqual(["AR", "KS", "MO", "OK"]);
    expect(w.threats).toEqual(["A couple tornadoes possible", "Scattered damaging wind gusts to 70 mph possible"]);
    expect(w.pds).toBe(false);
  });
  it("groups county polygons by watch number into one MultiPolygon event", () => {
    const r = parseSpcWatches({ counties: [county(-94.5, 36.9), county(-94.2, 36.9), county(-99, 33, "0702")], rss: parseFeedXml(rss) }, ctx);
    expect(r.candidates).toHaveLength(2);
    expect(valid(r.candidates)).toBe(true);
    const c = r.candidates.find((x) => x.metrics?.watch_number === 703)!;
    expect(c.title).toBe("Tornado Watch 703 — AR, KS, MO, OK");
    expect(c.geometry?.type).toBe("MultiPolygon");
    expect(c.metrics?.counties).toBe(2);
    expect(c.timestamp).toBe("2026-11-03T01:35:04.000Z");
    expect(c.resolvedAt).toBe("2026-11-03T09:00:00.000Z");
    expect(c.source.externalId).toBe("2026:703");
    const other = r.candidates.find((x) => x.metrics?.watch_number === 702)!;
    expect(other.title).toBe("Tornado Watch 702");
    expect(other.timestamp).toBe("2026-11-03T01:35:00.000Z");
  });
});

describe("geofon", () => {
  const text = [
    "#EventID|Time|Latitude|Longitude|Depth/km|Author|Catalog|Contributor|ContributorID|MagType|Magnitude|MagAuthor|EventLocationName|EventType",
    "gfz2026vmns|2026-11-02T16:49:14.36|34.441|26.435|20.0|||GFZ|gfz2026vmns|Mw|5.12||Crete, Greece|earthquake",
    "gfz2026vmzz|2026-11-02T10:00:00.00|10.0|10.0|5.0|||GFZ|gfz2026vmzz|mb|4.2||Somewhere|earthquake",
    "gfz2026vmyy|2026-11-02T10:00:00.00|40.0|20.0|0.0|||GFZ|gfz2026vmyy|mb|4.9||Quarry|quarry blast",
  ].join("\n");
  it("parses the FDSN text format (UTC times) and skips small or non-tectonic events", () => {
    const r = parseGeofon({ text }, ctx);
    expect(r.candidates).toHaveLength(1);
    expect(r.skipped).toBe(2);
    expect(valid(r.candidates)).toBe(true);
    const c = r.candidates[0];
    expect(c.title).toBe("M 5.1 earthquake — Crete, Greece");
    expect(c.timestamp).toBe("2026-11-02T16:49:14.360Z");
    expect(c.source.sourceType).toBe("SCIENTIFIC");
    expect(c.source.id).toBe("geofon:gfz2026vmns");
  });
});

describe("cyber-advisories", () => {
  const rss = (items: string) => `<?xml version="1.0"?><rss version="2.0"><channel><title>x</title>${items}</channel></rss>`;
  const item = (title: string, link: string, date: string) => `<item><title>${title}</title><link>${link}</link><pubDate>${date}</pubDate></item>`;
  it("normalises CERT-EU zone abbreviations", () => {
    expect(Date.parse(normalizeZone("Fri, 23 Oct 2026 16:36:26 CEST")!)).toBe(Date.parse("2026-10-23T14:36:26Z"));
    expect(normalizeZone("Fri, 30 Oct 26 12:00:00 +0000")).toBe("Fri, 30 Oct 26 12:00:00 +0000");
  });
  it("classifies advisories and skips KEV additions", () => {
    expect(cyberSubtype("cisa-alerts", "CISA Adds Two Known Exploited Vulnerabilities to Catalog")).toBeNull();
    expect(cyberSubtype("cisa-advisories", "#StopRansomware: SafePay Ransomware")).toBe("ransomware advisory");
    expect(cyberSubtype("cisa-advisories", "Chinese Government-linked Cyber Threat Actors Combine Automated and Hands-on Hacking Tools")).toBe("state-sponsored threat");
    expect(cyberSubtype("cert-eu", "2026-019: Critical Vulnerability in GitLab")).toBe("vulnerability advisory");
  });
  it("keeps NCSC news/reports only and places state-actor advisories at the issuer", () => {
    const ncsc = rss(
      item("Incident affecting ASOS customers", "https://www.ncsc.gov.uk/news/incident-affecting-asos-customers", "Tue, 27 Oct 2026 12:00:00 +0000") +
        item("Using TLS to protect data", "https://www.ncsc.gov.uk/guidance/using-tls-to-protect-data", "Tue, 27 Oct 2026 12:00:00 +0000") +
        item("Iranian cyber actors target dissidents in Germany", "https://www.ncsc.gov.uk/news/iranian-cyber-targeting", "Tue, 27 Oct 2026 12:00:00 +0000"),
    );
    const certeu = rss(item("2026-018: Critical Vulnerabilities in PHP", "https://cert.europa.eu/publications/security-advisories/2026-018/", "Fri, 23 Oct 2026 16:36:26 +0200"));
    const r = parseAgencyFeeds(cyberSpec, { feeds: [{ feed: "ncsc-uk", items: parseFeedXml(ncsc) }, { feed: "cert-eu", items: parseFeedXml(certeu) }] }, ctx);
    expect(r.candidates).toHaveLength(3);
    expect(valid(r.candidates)).toBe(true);
    const iran = r.candidates.find((c) => c.title.includes("Iranian"))!;
    expect(iran.subtype).toBe("state-sponsored threat");
    expect(iran.country).toBe("GB");
    expect(r.candidates.find((c) => c.title.includes("PHP"))!.title).toBe("CERT-EU: 2026-018: Critical Vulnerabilities in PHP");
  });
});

describe("uk-defence", () => {
  it("classifies MOD headlines and places them in a named foreign country", () => {
    expect(ukDefenceKind("New Belfast fabrication hall to support shipbuilding for decades").type).toBe("BUSINESS");
    expect(ukDefenceKind("RAF jets intercept Russian aircraft over the North Sea").type).toBe("CONFLICT");
    expect(ukDefenceKind("UK Germany Defence Ministerial Council Joint Statement").type).toBe("POLITICS");
    const atom = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>MOD</title>
      <entry><title>UK to lead multinational military training exercise to prepare for peace in Ukraine</title><link rel="alternate" type="text/html" href="https://www.gov.uk/government/news/uk-to-lead-exercise"/><updated>2026-11-03T00:01:03+00:00</updated></entry>
      <entry><title>Veterans honoured with medals at ceremony</title><link rel="alternate" type="text/html" href="https://www.gov.uk/government/news/medals"/><updated>2026-11-02T00:01:03+00:00</updated></entry>
    </feed>`;
    const r = parseAgencyFeeds(ukDefenceSpec, { feeds: [{ feed: "mod", items: parseFeedXml(atom) }] }, ctx);
    expect(r.candidates).toHaveLength(1);
    expect(r.skipped).toBe(1);
    expect(valid(r.candidates)).toBe(true);
    expect(r.candidates[0].country).toBe("UA");
    expect(r.candidates[0].type).toBe("CONFLICT");
  });
});

describe("fema-declarations", () => {
  const row = (id: string, area: string, date = "2026-10-27T00:00:00.000Z", type = "Hurricane", title = "HURRICANE ISAIAS") => ({
    femaDeclarationString: id,
    disasterNumber: Number(id.split("-")[1]),
    state: id.slice(-2),
    declarationType: id.slice(0, 2),
    declarationDate: date,
    incidentType: type,
    declarationTitle: title,
    incidentBeginDate: "2026-10-06T00:00:00.000Z",
    designatedArea: area,
    iaProgramDeclared: false,
    ihProgramDeclared: true,
    paProgramDeclared: true,
    hmProgramDeclared: false,
  });
  it("groups counties into one declaration at the state", () => {
    const r = parseFema({ rows: [row("DR-4955-FL", "Bay (County)"), row("DR-4955-FL", "Gulf (County)"), row("EM-3659-GU", "Guam (Territory)", "2026-10-17T00:00:00.000Z", "Other", "TYPHOON CHAMPI"), row("DR-4900-TX", "Harris (County)", "2026-08-01T00:00:00.000Z")] }, ctx);
    expect(r.candidates).toHaveLength(2);
    expect(r.skipped).toBe(1);
    expect(valid(r.candidates)).toBe(true);
    const fl = r.candidates.find((c) => c.source.externalId === "DR-4955-FL")!;
    expect(fl.title).toBe("Major disaster declaration for Florida: Hurricane Isaias (DR-4955-FL)");
    expect(fl.type).toBe("WEATHER");
    expect(fl.metrics?.designated_areas).toBe(2);
    expect(fl.geoPrecision).toBe("region");
    expect(r.candidates.find((c) => c.source.externalId === "EM-3659-GU")!.locationName).toBeTruthy();
    expect(femaCategory("Severe Storms and Flooding")).toBe("FLOOD");
    expect(femaCategory("Fire")).toBe("FIRE");
  });
});

describe("sec-13d", () => {
  const atom = `<feed><entry><title>SCHEDULE 13D - Arkhouse Management Co. LP (0002021808) (Filed by)</title><link rel="alternate" type="text/html" href="https://www.sec.gov/Archives/edgar/data/2021808/000121390026115110/0001213900-26-115110-index.htm"/><updated>2026-11-02T20:55:34-05:00</updated><id>urn:tag:sec.gov,2008:accession-number=0001213900-26-115110</id></entry>
<entry><title>SCHEDULE 13D - Dine Brands Global, Inc. (0000049754) (Subject)</title><link rel="alternate" type="text/html" href="https://www.sec.gov/Archives/edgar/data/49754/000121390026115110/0001213900-26-115110-index.htm"/><updated>2026-11-02T20:55:34-05:00</updated><id>urn:tag:sec.gov,2008:accession-number=0001213900-26-115110</id></entry>
<entry><title>SCHEDULE 13D/A - Other Corp (0000000001) (Subject)</title><link rel="alternate" type="text/html" href="https://www.sec.gov/x"/><updated>2026-11-02T20:00:00-05:00</updated><id>urn:tag:sec.gov,2008:accession-number=0000000001-26-000001</id></entry></feed>`;
  const xml = `<edgarSubmission xmlns="http://www.sec.gov/edgar/schedule13D"><headerData><submissionType>SCHEDULE 13D</submissionType></headerData><formData><coverPageHeader><securitiesClassTitle>Common Stock, $0.01 par value per share</securitiesClassTitle><dateOfEvent>10/26/2026</dateOfEvent><issuerInfo><issuerCIK>0000049754</issuerCIK><issuerCusips><issuerCusipNumber>254423106</issuerCusipNumber></issuerCusips><issuerName>Dine Brands Global, Inc.</issuerName></issuerInfo></coverPageHeader><reportingPersons><reportingPersonInfo><reportingPersonName>Arkhouse Management Co. LP</reportingPersonName><aggregateAmountOwned>546700.00</aggregateAmountOwned><percentOfClass>4.3</percentOfClass></reportingPersonInfo><reportingPersonInfo><reportingPersonName>Arkhouse GP LLC</reportingPersonName><aggregateAmountOwned>73700.00</aggregateAmountOwned><percentOfClass>0.6</percentOfClass></reportingPersonInfo></reportingPersons><items1To7><item4><transactionPurpose>The Reporting Persons believe that the Issuer's Common Stock is undervalued.</transactionPurpose></item4></items1To7></formData></edgarSubmission>`;
  const txt = `<SEC-HEADER>0001213900-26-115110.hdr.sgml : 20261102
SUBJECT COMPANY:

	COMPANY DATA:
		COMPANY CONFORMED NAME:			Dine Brands Global, Inc.

	BUSINESS ADDRESS:
		STREET 1:		10 WEST WALNUT STREET, 5TH FLOOR
		CITY:			LOS ANGELES
		STATE:			CA

	MAIL ADDRESS:
		CITY:			PASADENA

FILED BY:

	BUSINESS ADDRESS:
		CITY:			NEW YORK
		STATE:			NY
</SEC-HEADER>
<DOCUMENT><TEXT><XML>${xml}</XML></TEXT></DOCUMENT>`;
  it("lists original 13D filings by subject company", () => {
    const e = parse13dAtom(atom);
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({ accession: "0001213900-26-115110", subjectCik: "0000049754", subjectName: "Dine Brands Global, Inc." });
  });
  it("reads the subject address and the cover page, and builds the event", () => {
    const s = split13dSubmission(txt);
    expect(s).toMatchObject({ city: "LOS ANGELES", state: "CA" });
    const cover = readCover(s.xml!);
    expect(cover.cusip).toBe("254423106");
    expect(cover.eventDate).toBe("2026-10-26");
    expect(cover.persons.map((p) => p.percent)).toEqual([4.3, 0.6]);
    const entry = parse13dAtom(atom)[0];
    const r = parseSec13d({ filings: [{ ...entry, city: s.city, state: s.state, xml: s.xml! }] }, ctx);
    expect(r.candidates).toHaveLength(1);
    expect(valid(r.candidates)).toBe(true);
    const c = r.candidates[0];
    expect(c.title).toBe("Activist/control stake: Arkhouse Management Co. LP reports 4.3% of Dine Brands Global, Inc. (Schedule 13D)");
    expect(c.locationName).toContain("Los Angeles");
    expect(c.timestamp).toBe("2026-11-03T01:55:34.000Z");
    expect(c.summary).toContain("undervalued");
  });
});
