import { describe, expect, it } from "vitest";
import { EventCandidateSchema } from "@/types/events";
import { parseIoda } from "@/data-sources/ioda/parser";
import { extractDelays, parseFaa } from "@/data-sources/faa/parser";
import { parseTsunami, tsunamiLevel } from "@/data-sources/tsunami/parser";
import { countriesFromTitle, parseWho } from "@/data-sources/who/parser";
import { parseSecAtom } from "@/data-sources/sec/client";
import { parseSec } from "@/data-sources/sec/parser";
import { airportByCode, locateAddress } from "@/lib/geo/gazetteer";
import { NOW } from "./helpers";

const ctx = { now: NOW, retrievedAt: new Date(NOW).toISOString() };
const valid = (cs: unknown[]) => cs.every((c) => EventCandidateSchema.safeParse(c).success);

describe("reference geography", () => {
  it("finds airports by IATA/ICAO", () => {
    expect(airportByCode("BOS")?.name).toMatch(/Logan/);
    expect(airportByCode("KJFK")?.iata).toBe("JFK");
  });
  it("locates company addresses", () => {
    expect(locateAddress("Atlanta", "GA")).toMatchObject({ precision: "city" });
    expect(locateAddress("Smallville", "KS")?.precision).toBe("region");
    expect(locateAddress(null, "Japan")?.precision).toBe("country");
  });
});

describe("IODA", () => {
  it("keeps the strongest signal per outage and drops noise", () => {
    const start = Math.floor(NOW / 1000) - 7200;
    const r = parseIoda({ error: null, data: [
      { location: "country/IR", location_name: "Iran", start, duration: 3600, method: "median", datasource: "bgp", status: 0, score: 5000 },
      { location: "country/IR", location_name: "Iran", start: start + 300, duration: 3600, method: "median", datasource: "gtr", status: 0, score: 90000 },
      { location: "country/FR", location_name: "France", start, duration: 600, method: "median", datasource: "bgp", status: 0, score: 50 },
    ] }, ctx);
    expect(r.candidates).toHaveLength(1);
    expect(r.candidates[0]).toMatchObject({ country: "IR", subtype: "internet-outage", geoPrecision: "country" });
    expect(valid(r.candidates)).toBe(true);
  });
});

describe("FAA", () => {
  const xml = `<AIRPORT_STATUS_INFORMATION><Update_Time>Mon Oct 5 01:50:13 2026 GMT</Update_Time>
  <Delay_type><Name>Ground Delay Programs</Name><Ground_Delay_List><Ground_Delay><ARPT>BOS</ARPT><Reason>low ceilings</Reason><Avg>2 hours</Avg><Max>3 hours</Max></Ground_Delay></Ground_Delay_List></Delay_type>
  <Delay_type><Name>Airport Closures</Name><Airport_Closure_List><Airport><ARPT>LAX</ARPT><Reason>!LAX AD AP CLSD TO NON SKED TRANSIENT GA ACFT</Reason></Airport></Airport_Closure_List></Delay_type>
  </AIRPORT_STATUS_INFORMATION>`;
  it("parses delays at real airport coordinates and ignores partial GA restrictions", () => {
    expect(extractDelays(xml).map((d) => d.airport)).toEqual(["BOS"]);
    const r = parseFaa({ xml }, ctx);
    expect(r.candidates[0]).toMatchObject({ type: "AVIATION", subtype: "ground-delay", country: "US", geoPrecision: "exact" });
    expect(r.candidates[0].latitude).toBeCloseTo(42.36, 1);
    expect(valid(r.candidates)).toBe(true);
  });
});

describe("tsunami", () => {
  it("parses entries with coordinates and message level", () => {
    const t = new Date(NOW - 3600_000).toISOString();
    const xml = `<feed><title>Tsunami Warning Number 2</title><entry><title>120 km S of Kodiak, Alaska</title><updated>${t}</updated><geo:lat>56.5</geo:lat><geo:long>-152.4</geo:long><summary>Hazardous waves possible</summary><link href="https://www.tsunami.gov/events/x"/><id>urn:x</id></entry></feed>`;
    const r = parseTsunami({ feeds: [{ center: "National Tsunami Warning Center (Palmer, AK)", xml }] }, ctx);
    expect(tsunamiLevel("Tsunami Warning Number 2")).toBe("warning");
    expect(r.candidates[0]).toMatchObject({ subtype: "tsunami-warning", latitude: 56.5 });
    expect(r.candidates[0].metrics?.alert_level).toBe("red");
    expect(valid(r.candidates)).toBe(true);
  });
});

describe("WHO", () => {
  it("resolves WHO country names", () => {
    expect(countriesFromTitle("Ebola disease caused by Bundibugyo virus - Democratic Republic of the Congo").map((c) => c.code)).toEqual(["CD"]);
    expect(countriesFromTitle("Avian Influenza A(H5N1) - Cambodia and Viet Nam").map((c) => c.code)).toEqual(["KH", "VN"]);
  });
  it("creates HEALTH events at the affected country", () => {
    const r = parseWho({ value: [{ Id: "1", Title: "Cholera - Sudan", UrlName: "2026-DON700", DonId: "2026-DON700", PublicationDate: new Date(NOW - 86_400_000).toISOString(), LastModified: "", Summary: "<p>Cases reported</p>" }] }, ctx);
    expect(r.candidates[0]).toMatchObject({ type: "HEALTH", country: "SD", geoPrecision: "country" });
    expect(r.candidates[0].description).toBe("Cases reported");
    expect(valid(r.candidates)).toBe(true);
  });
});

describe("SEC", () => {
  const atom = `<feed><entry><title>8-K - Acme Corp (0000000001) (Filer)</title><link rel="alternate" type="text/html" href="https://www.sec.gov/Archives/edgar/data/1/x-index.htm"/>
  <summary type="html"> &lt;b&gt;Filed:&lt;/b&gt; 2026-10-02 &lt;br&gt;Item 1.05: Material Cybersecurity Incidents &lt;br&gt;Item 9.01: Financial Statements and Exhibits</summary>
  <updated>2026-10-02T17:29:10-04:00</updated><id>urn:tag:sec.gov,2008:accession-number=0000000001-26-000001</id></entry>
  <entry><title>8-K - Routine Inc (0000000002) (Filer)</title><link href="https://www.sec.gov/x"/><summary type="html">Item 7.01: Regulation FD Disclosure &lt;br&gt;Item 9.01: Exhibits</summary><updated>2026-10-02T17:00:00-04:00</updated><id>urn:tag:sec.gov,2008:accession-number=0000000002-26-000002</id></entry></feed>`;
  it("keeps material filings at the company's HQ", () => {
    const entries = parseSecAtom(atom);
    expect(entries.map((e) => e.items)).toEqual([["1.05", "9.01"], ["7.01", "9.01"]]);
    const company = (cik: string, name: string) => ({ cik, name, tickers: ["ACME"], exchanges: ["NYSE"], sicDescription: null, city: "SEATTLE", stateOrCountry: "WA", countryDescription: null });
    const r = parseSec({ entries, companies: { "0000000001": company("0000000001", "Acme Corp"), "0000000002": company("0000000002", "Routine Inc") } }, ctx);
    expect(r.candidates).toHaveLength(1);
    expect(r.candidates[0]).toMatchObject({ type: "BUSINESS", title: "Acme Corp (ACME): Material cybersecurity incident", geoPrecision: "city" });
    expect(r.candidates[0].metrics?.ticker).toBe("ACME");
    expect(valid(r.candidates)).toBe(true);
  });
});
