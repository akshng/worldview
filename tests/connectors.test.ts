import { describe, expect, it } from "vitest";
import { EventCandidateSchema } from "@/types/events";
import { parseUsgsFeed } from "@/data-sources/usgs/parser";
import { parseExportTsv } from "@/data-sources/gdelt/client";
import { parseGdelt, titleFromUrl } from "@/data-sources/gdelt/parser";
import { parseFirmsCsv } from "@/data-sources/nasa-firms/client";
import { clusterDetections, parseFirms } from "@/data-sources/nasa-firms/parser";
import { parseNwsAlerts } from "@/data-sources/weather/parser";
import { parseGdacs } from "@/data-sources/gdacs/parser";
import { parseEonet } from "@/data-sources/eonet/parser";
import { generateDemoEvents } from "@/data-sources/demo/parser";
import type { UsgsFeed } from "@/data-sources/usgs/types";
import { NOW } from "./helpers";

const ctx = { now: NOW, retrievedAt: new Date(NOW).toISOString() };
const allValid = (cs: unknown[]) => cs.every((c) => EventCandidateSchema.safeParse(c).success);

describe("USGS parser", () => {
  const feed: UsgsFeed = {
    type: "FeatureCollection",
    metadata: { generated: NOW, url: "", title: "", count: 3 },
    features: [
      { type: "Feature", id: "us1", geometry: { type: "Point", coordinates: [141.4, 38.27, 35] }, properties: { mag: 6.24, place: "40 km E of Sendai, Japan", time: NOW - 600_000, updated: NOW, url: "https://earthquake.usgs.gov/earthquakes/eventpage/us1", detail: "", felt: 120, cdi: 5, mmi: 6, alert: "yellow", status: "reviewed", tsunami: 1, sig: 700, net: "us", code: "1", sources: "", magType: "mww", type: "earthquake", title: "M 6.2 - 40 km E of Sendai, Japan" } },
      { type: "Feature", id: "us2", geometry: { type: "Point", coordinates: [-117, 34, 0] }, properties: { mag: 2.6, place: "5 km N of Somewhere, CA", time: NOW, updated: NOW, url: "https://earthquake.usgs.gov/x", detail: "", felt: null, cdi: null, mmi: null, alert: null, status: "automatic", tsunami: 0, sig: 10, net: "ci", code: "2", sources: "", magType: "ml", type: "quarry blast", title: "" } },
      { type: "Feature", id: "us3", geometry: { type: "Point", coordinates: [10, 10, 10] }, properties: { mag: 3.1, place: "Somewhere", time: NOW, updated: NOW, url: "https://earthquake.usgs.gov/y", detail: "", felt: null, cdi: null, mmi: null, alert: null, status: "deleted", tsunami: 0, sig: 10, net: "us", code: "3", sources: "", magType: "mb", type: "earthquake", title: "" } },
    ],
  };
  const r = parseUsgsFeed(feed, ctx);

  it("keeps only real, non-deleted earthquakes", () => {
    expect(r.candidates).toHaveLength(1);
    expect(r.skipped).toBe(2);
    expect(allValid(r.candidates)).toBe(true);
  });

  it("normalises fields and states facts only", () => {
    const c = r.candidates[0];
    expect(c.title).toBe("M 6.2 earthquake — 40 km E of Sendai, Japan");
    expect(c.metrics).toMatchObject({ magnitude: 6.2, depth_km: 35, tsunami: true, alert_level: "yellow" });
    expect(c.source.assertion).toBe("OFFICIAL_FINAL");
    expect(c.summary).toContain("not itself a warning");
  });
});

const gdeltLine = (o: Partial<Record<number, string>>) => {
  const c = new Array(61).fill("");
  Object.assign(c, {
    0: "1", 1: "20261004", 5: "GOV", 6: "POLICE", 15: "OPP", 16: "PROTESTER", 25: "1",
    26: "141", 27: "141", 28: "14", 29: "3", 30: "-6.5", 31: "4", 32: "2", 33: "4", 34: "-3.2",
    51: "4", 52: "Lyon, Rhône-Alpes, France", 53: "FR", 56: "45.75", 57: "4.85", 58: "-1456928",
    59: "20261004114500", 60: "https://www.example-news.fr/2026/10/04/thousands-march-in-lyon-against-pension-reform-123456",
    ...o,
  });
  return c.join("\t");
};

describe("GDELT parser", () => {
  const tsv = [
    gdeltLine({}),
    gdeltLine({ 0: "2", 26: "1411", 27: "141" }), // same article+place → collapsed
    gdeltLine({ 0: "2b", 52: "Paris, Ile-de-France, France", 56: "48.85", 57: "2.35", 58: "-1456929" }), // same article, other place → collapsed
    gdeltLine({ 0: "2c", 26: "190", 27: "190", 28: "19", 32: "3", 33: "5", 60: "https://www.example.com/sports/2026/10/04/team-crushes-rivals-in-brutal-clash" }), // sports section → dropped
    gdeltLine({ 0: "3", 51: "1", 52: "France" }), // country-level geo → dropped
    gdeltLine({ 0: "4", 25: "0" }), // not root → dropped
    gdeltLine({ 0: "5", 26: "042", 27: "042", 28: "04", 33: "2" }), // low-signal cooperation → dropped
    gdeltLine({ 0: "6", 1: "20260901" }), // stale event date → dropped
    gdeltLine({ 0: "7", 26: "190", 27: "190", 28: "19", 32: "1", 33: "1", 60: "https://x.example/one-off-story-about-things" }), // single-source violence → dropped
  ].join("\n");
  const rows = parseExportTsv(tsv);
  const r = parseGdelt({ files: [{ url: "x", rows }] }, ctx);

  it("parses the 61-column export", () => {
    expect(rows).toHaveLength(9);
    expect(rows[0]).toMatchObject({ eventRootCode: "14", geoType: 4, lat: 45.75, lon: 4.85, numArticles: 4 });
  });

  it("filters noise and collapses rows per article", () => {
    expect(r.candidates).toHaveLength(1);
    expect(allValid(r.candidates)).toBe(true);
    const c = r.candidates[0];
    expect(c.type).toBe("PROTEST");
    expect(c.country).toBeNull(); // FIPS codes are not trusted as ISO
    expect(c.source.assertion).toBe("MEDIA_REPORT");
    expect(c.source.titleIsDerived).toBe(true);
    expect(c.summary).toMatch(/Machine-coded/);
  });

  it("routes police/crime stories away from CONFLICT", () => {
    const crime = parseExportTsv(gdeltLine({ 0: "8", 5: "USACOP", 6: "POLICE", 12: "COP", 15: "USACRM", 16: "GUNMAN", 22: "CRM", 26: "190", 27: "190", 28: "19", 32: "3", 33: "5", 60: "https://n.example/police-say-gunman-opened-fire-downtown" }));
    const war = parseExportTsv(gdeltLine({ 0: "9", 5: "RUSMIL", 6: "RUSSIAN ARMY", 12: "MIL", 26: "195", 27: "195", 28: "19", 32: "3", 33: "5", 60: "https://n.example/drone-strikes-hit-energy-facilities-overnight" }));
    const cats = parseGdelt({ files: [{ url: "x", rows: [...crime, ...war] }] }, ctx).candidates.map((c) => [c.type, c.subtype]);
    expect(cats).toContainEqual(["NEWS", "crime / public safety"]);
    expect(cats).toContainEqual(["CONFLICT", "aerial attack"]);
  });

  it("derives readable titles from URL slugs and ignores ids", () => {
    expect(titleFromUrl("https://a.com/news/2026/10/04/thousands-march-in-lyon-against-reform-123456")).toBe("Thousands march in lyon against reform");
    expect(titleFromUrl("https://a.com/article/5092f018-6fb1-51ff-89e7-ab12cd34ef56")).toBeNull();
    expect(titleFromUrl("https://a.com/teen-13-year-old-rescued-from-river.html")).toBe("Teen 13 year old rescued from river");
  });
});

describe("FIRMS parser", () => {
  const csvHead = "latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,confidence,version,bright_ti5,frp,daynight";
  const rows: string[] = [];
  for (let i = 0; i < 25; i++) rows.push(`${-10 + i * 0.01},${130 + i * 0.01},330,0.4,0.4,2026-10-04,0${(100 + i).toString()},N,nominal,2.0NRT,290,${5 + i},D`);
  rows.push("-40,150,330,0.4,0.4,2026-10-04,0300,N,low,2.0NRT,290,999,D"); // low confidence ignored
  rows.push("50,10,330,0.4,0.4,2026-10-04,0300,N,high,2.0NRT,290,3,N"); // isolated small hotspot
  const dets = parseFirmsCsv([csvHead, ...rows].join("\n"));

  it("parses detections with UTC times", () => {
    expect(dets).toHaveLength(27);
    expect(new Date(dets[0].acquiredAt).toISOString()).toBe("2026-10-04T01:00:00.000Z");
  });

  it("clusters adjacent hotspots and drops small/low-confidence ones", () => {
    const clusters = clusterDetections(dets);
    expect(clusters.find((c) => c.detections.length === 25)).toBeTruthy();
    const r = parseFirms({ product: "VIIRS_SNPP_NRT", via: "public-file", detections: dets }, ctx);
    expect(r.candidates).toHaveLength(1);
    expect(allValid(r.candidates)).toBe(true);
    expect(r.candidates[0].metrics?.detections).toBe(25);
    expect(r.candidates[0].summary).toMatch(/agricultural burning/);
  });
});

describe("NWS / GDACS / EONET parsers", () => {
  it("parses NWS alerts with polygons and skips zone-only alerts", () => {
    const poly = { type: "Polygon" as const, coordinates: [[[-80, 32], [-79, 32], [-79, 33], [-80, 33], [-80, 32]]] };
    const props = (id: string, event: string) => ({
      "@id": `https://api.weather.gov/alerts/${id}`, id, event, headline: `${event} issued`, description: "<b>HAZARD</b>...Flooding", instruction: null,
      severity: "Severe" as const, certainty: "Likely", urgency: "Immediate", sent: "2026-10-04T10:00:00-04:00", effective: "2026-10-04T10:00:00-04:00",
      onset: null, expires: "2026-10-04T16:00:00-04:00", ends: null, areaDesc: "Charleston, SC", senderName: "NWS Charleston SC", messageType: "Alert", status: "Actual",
    });
    const r = parseNwsAlerts({ type: "FeatureCollection", features: [
      { id: "a", type: "Feature", geometry: poly, properties: props("a", "Flash Flood Warning") },
      { id: "b", type: "Feature", geometry: null, properties: props("b", "Heat Advisory") },
    ] }, ctx);
    expect(r.candidates).toHaveLength(1);
    expect(r.skipped).toBe(1);
    expect(allValid(r.candidates)).toBe(true);
    expect(r.candidates[0]).toMatchObject({ type: "FLOOD", subtype: "flash-flood", country: "US", resolvedAt: "2026-10-04T20:00:00.000Z" });
    expect(r.candidates[0].description).not.toContain("<b>");
  });

  it("parses GDACS events and treats zone-less dates as UTC", () => {
    const r = parseGdacs({ type: "FeatureCollection", features: [{
      type: "Feature", geometry: { type: "Point", coordinates: [120, 15] },
      properties: { eventtype: "TC", eventid: 1, episodeid: 3, eventname: "HAGUPIT", name: "Tropical Cyclone HAGUPIT-26", description: "", htmldescription: "Orange alert", url: { report: "https://www.gdacs.org/report.aspx?eventid=1" },
        alertlevel: "Orange", alertscore: 2, iscurrent: "true", country: "Philippines", fromdate: "2026-10-02T00:00:00", todate: "2026-10-06T00:00:00", datemodified: "2026-10-04T06:00:00", iso3: "PHL", source: "JTWC",
        severitydata: { severity: 185, severitytext: "Category 3", severityunit: "km/h" }, affectedcountries: [{ iso2: "PH", iso3: "PHL", countryname: "Philippines" }] },
    }] }, ctx);
    expect(allValid(r.candidates)).toBe(true);
    expect(r.candidates[0]).toMatchObject({ type: "WEATHER", title: "Tropical cyclone HAGUPIT — Philippines", timestamp: "2026-10-04T06:00:00.000Z", country: "PH" });
    expect(r.candidates[0].metrics).toMatchObject({ alert_level: "orange", wind_kts: 100 });
  });

  it("parses EONET events using the latest geometry", () => {
    const r = parseEonet({ events: [{
      id: "EONET_1", title: "Typhoon Test", description: null, link: "https://eonet.gsfc.nasa.gov/api/v3/events/EONET_1", closed: null,
      categories: [{ id: "severeStorms", title: "Severe Storms" }], sources: [{ id: "JTWC", url: "https://www.metoc.navy.mil/jtwc/x" }],
      geometry: [
        { date: "2026-10-03T00:00:00Z", type: "Point", coordinates: [140, 15], magnitudeValue: 40, magnitudeUnit: "kts" },
        { date: "2026-10-04T00:00:00Z", type: "Point", coordinates: [138, 17], magnitudeValue: 90, magnitudeUnit: "kts" },
      ],
    }] }, ctx);
    expect(allValid(r.candidates)).toBe(true);
    expect(r.candidates[0]).toMatchObject({ type: "WEATHER", latitude: 17, longitude: 138, metrics: { wind_kts: 90 } });
    expect(r.candidates[0].source.sourceName).toBe("NASA EONET via Joint Typhoon Warning Center");
  });
});

describe("demo generator", () => {
  it("produces only clearly-labelled synthetic events without source URLs", () => {
    const r = generateDemoEvents({ now: NOW }, ctx);
    expect(r.candidates.length).toBeGreaterThan(100);
    expect(allValid(r.candidates)).toBe(true);
    for (const c of r.candidates) {
      expect(c.isSynthetic).toBe(true);
      expect(c.title.startsWith("[SIMULATED]")).toBe(true);
      expect(c.source.sourceUrl).toBeNull();
      expect(c.source.assertion).toBe("SYNTHETIC");
    }
  });
});
