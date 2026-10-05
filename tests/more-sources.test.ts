import { describe, expect, it } from "vitest";
import { EventCandidateSchema } from "@/types/events";
import { parseEmsc, titleCaseRegion } from "@/data-sources/emsc/parser";
import { parseUsgsVolcano } from "@/data-sources/usgs-volcano/parser";
import { categoryFor, parseCems, parsePointWkt } from "@/data-sources/copernicus-ems/parser";
import { londonToUtc, parseUkFloods } from "@/data-sources/uk-floods/parser";
import { parseNhc, saffirSimpson } from "@/data-sources/nhc/parser";

const now = Date.parse("2026-10-05T19:00:00Z");
const ctx = { now, retrievedAt: new Date(now).toISOString() };
const valid = (xs: unknown[]) => xs.every((x) => EventCandidateSchema.safeParse(x).success);

describe("EMSC", () => {
  it("parses earthquakes and skips non-earthquake event types", () => {
    const base = { time: "2026-10-05T18:28:28.162Z", lat: -5.52, lon: 150.33, depth: 124.9, mag: 4.4, magtype: "mb", auth: "NEIC" };
    const r = parseEmsc(
      {
        features: [
          { id: "a", geometry: null, properties: { ...base, unid: "a", flynn_region: "NEW BRITAIN REGION, P.N.G.", evtype: "ke" } },
          { id: "b", geometry: null, properties: { ...base, unid: "b", evtype: "qb" } },
        ],
      },
      ctx,
    );
    expect(r.candidates).toHaveLength(1);
    expect(r.skipped).toBe(1);
    expect(r.candidates[0].title).toBe("M 4.4 earthquake — New Britain Region, P.N.G.");
    expect(valid(r.candidates)).toBe(true);
  });
  it("title-cases Flinn-Engdahl region names", () => {
    expect(titleCaseRegion("SOUTH OF FIJI ISLANDS")).toBe("South of Fiji Islands");
  });
});

describe("USGS volcano alerts", () => {
  it("needs a location and reads the alert level", () => {
    const v = {
      obs_fullname: "Alaska Volcano Observatory", obs_abbr: "avo", volcano_name: "Great Sitkin", vnum: "311120",
      notice_identifier: "x", sent_utc: "2026-10-04 19:18:09", color_code: "ORANGE", alert_level: "WATCH", notice_url: "https://volcanoes.usgs.gov/n",
    };
    const r = parseUsgsVolcano({ elevated: [v, { ...v, vnum: "nope" }], info: { "311120": { vnum: "311120", latitude: 52.08, longitude: -176.11 } } }, ctx);
    expect(r.candidates).toHaveLength(1);
    expect(r.skipped).toBe(1);
    expect(r.candidates[0].timestamp).toBe("2026-10-04T19:18:09.000Z");
    expect(r.candidates[0].metrics).toMatchObject({ alert_level: "WATCH", aviation_color_code: "ORANGE" });
    expect(valid(r.candidates)).toBe(true);
  });
});

describe("Copernicus EMS", () => {
  it("parses WKT centroids and maps categories", () => {
    expect(parsePointWkt("POINT (24.97 35.22)")).toEqual({ lat: 35.22, lon: 24.97 });
    expect(parsePointWkt("POLYGON ((0 0))")).toBeNull();
    expect(categoryFor("Wildfire").type).toBe("FIRE");
    expect(categoryFor("Mass movement").type).toBe("DISASTER");
  });
  it("keeps open activations and drops old closed ones", () => {
    const a = { code: "EMSR933", countries: ["Greece"], eventTime: "2026-10-01T07:00:00", name: "Flood in Crete, Greece", centroid: "POINT (24.97 35.22)", activationTime: "2026-10-04T11:02:00", category: "Flood", lastUpdate: null, closed: false, gdacsId: null };
    const old = { ...a, code: "EMSR100", activationTime: "2026-01-01T00:00:00", closed: true };
    const r = parseCems({ results: [a, old] }, ctx);
    expect(r.candidates.map((c) => c.source.externalId)).toEqual(["EMSR933"]);
    expect(r.candidates[0].type).toBe("FLOOD");
    expect(r.candidates[0].timestamp).toBe("2026-10-01T07:00:00.000Z");
    expect(valid(r.candidates)).toBe(true);
  });
});

describe("UK flood warnings", () => {
  it("converts UK local time to UTC (BST and GMT)", () => {
    expect(londonToUtc("2026-10-05T17:17:00").toISOString()).toBe("2026-10-05T16:17:00.000Z");
    expect(londonToUtc("2026-12-05T17:17:00").toISOString()).toBe("2026-12-05T17:17:00.000Z");
  });
  it("supersedes the same area's other severity levels", () => {
    const w = { "@id": "x", description: "River Waveney", floodAreaID: "054WATBT3", severity: "Flood warning", severityLevel: 2, timeRaised: "2026-10-05T17:17:09", isTidal: true };
    const r = parseUkFloods({ items: [w, { ...w, floodAreaID: "unknown" }], areas: { "054WATBT3": { lat: 52.49, long: 1.62 } } }, ctx);
    expect(r.candidates).toHaveLength(1);
    expect(r.candidates[0].supersedes).toEqual(["uk-floods:054WATBT3:1", "uk-floods:054WATBT3:3"]);
    expect(r.candidates[0].country).toBe("GB");
    expect(valid(r.candidates)).toBe(true);
  });
});

describe("NHC", () => {
  it("derives the Saffir-Simpson category", () => {
    expect(saffirSimpson(63)).toBeNull();
    expect(saffirSimpson(75)).toBe(1);
    expect(saffirSimpson(140)).toBe(5);
  });
  it("parses active storms", () => {
    const r = parseNhc(
      { activeStorms: [{ id: "ep182026", binNumber: "EP3", name: "Rachel", classification: "HU", intensity: "75", pressure: "976", latitudeNumeric: 20.4, longitudeNumeric: -116.2, movementDir: 275, movementSpeed: 7, lastUpdate: "2026-10-05T15:00:00.000Z" }] },
      ctx,
    );
    expect(r.candidates[0].title).toBe("Hurricane Rachel (Category 1) — tropical cyclone");
    expect(r.candidates[0].summary).toContain("Moving W at 7 mph");
    expect(valid(r.candidates)).toBe(true);
  });
});
