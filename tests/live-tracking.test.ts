import { describe, expect, it } from "vitest";
import { navStatusLabel, parseAisMessage, parseDigitraffic, shipCategory } from "@/layers/maritime/parser";
import { parseAdsbLolMil } from "@/layers/military-aircraft/parser";
import { mergeGroups, parseGp, parseOmmEpoch, type CelestrakGp } from "@/layers/satellites/parser";
import { gmst, groundTrack, sgp4, sgp4init, subPoint, temeToGeodetic } from "@/layers/satellites/sgp4";
import { milFeatures, prepareSats, satFeatures, satTrackFeatures, vesselFeatures } from "@/components/globe/tracking";

const NOW = Date.UTC(2026, 9, 7, 22, 51, 50);

describe("Digitraffic AIS", () => {
  const loc = {
    dataUpdatedTime: "2026-10-07T22:51:50Z",
    features: [
      {
        mmsi: 230631000,
        geometry: { coordinates: [24.95123456, 60.16] as [number, number] },
        properties: { mmsi: 230631000, sog: 12.3, cog: 245.1, navStat: 0, heading: 244, timestampExternal: NOW - 30_000 },
      },
      // not-available sentinels
      { mmsi: 1, geometry: { coordinates: [20, 59] as [number, number] }, properties: { mmsi: 1, sog: 102.3, cog: 360, heading: 511, timestampExternal: NOW } },
      // too old
      { mmsi: 2, geometry: { coordinates: [20, 59] as [number, number] }, properties: { mmsi: 2, sog: 1, timestampExternal: NOW - 2 * 3600_000 } },
      // bad position
      { mmsi: 3, geometry: { coordinates: [200, 59] as [number, number] }, properties: { mmsi: 3, timestampExternal: NOW } },
    ],
  };
  const vessels = [{ mmsi: 230631000, name: "FINNTIDE ", shipType: 70, destination: "PL GDY " }];

  it("joins positions with metadata and drops stale / invalid rows", () => {
    const rows = parseDigitraffic(loc, vessels, 3600_000, NOW);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual([230631000, "FINNTIDE", 24.9512, 60.16, 12.3, 245.1, 244, 0, NOW - 30_000, 70, "PL GDY"]);
    expect(rows[1].slice(4, 7)).toEqual([null, null, null]);
    expect(rows[1][1]).toBe("");
    expect(rows[1][9]).toBeNull();
  });

  it("tolerates garbage", () => {
    expect(parseDigitraffic({}, [], 1000, NOW)).toEqual([]);
    expect(parseDigitraffic({ features: [null as never] }, undefined, 1000, NOW)).toEqual([]);
  });

  it("AISStream rows keep the same width", () => {
    const row = parseAisMessage({
      MessageType: "PositionReport",
      MetaData: { MMSI: 1, latitude: 1, longitude: 2, time_utc: "2026-10-07 22:51:50.1 +0000 UTC" },
      Message: { PositionReport: { Cog: 10, Sog: 3, TrueHeading: 511, NavigationalStatus: 0 } },
    });
    expect(row).toHaveLength(11);
  });

  it("categorises AIS ship types", () => {
    expect(shipCategory(70)).toBe("cargo");
    expect(shipCategory(84)).toBe("tanker");
    expect(shipCategory(60)).toBe("passenger");
    expect(shipCategory(30)).toBe("fishing");
    expect(shipCategory(52)).toBe("service");
    expect(shipCategory(35)).toBe("military");
    expect(shipCategory(null)).toBe("other");
    expect(navStatusLabel(5)).toBe("moored");
    expect(navStatusLabel(15)).toBeNull();
  });

  it("builds features with a category for colouring", () => {
    const fc = vesselFeatures({ fields: [], rows: parseDigitraffic(loc, vessels, 3600_000, NOW), source: "digitraffic" });
    expect(fc.features[0].properties).toMatchObject({ name: "FINNTIDE", cat: "cargo", heading: 244, dest: "PL GDY" });
    expect(fc.features[1].properties?.cat).toBe("other");
  });
});

describe("adsb.lol military", () => {
  const raw = {
    now: 1791413566500,
    ac: [
      { hex: "AE03F6", flight: "PAT171  ", r: "84-00171", t: "BE20", alt_baro: 25000, gs: 245.5, track: 86.26, lat: 60.925474, lon: -158.744888, squawk: "4724", seen_pos: 6.4 },
      { hex: "ae5aef", flight: "", r: "15-20781", t: "H60", alt_baro: "ground", lat: 21.5, lon: -158.1, seen_pos: 1 },
      { hex: "ae0000", t: "C17" }, // no position
      { hex: "ae0001", lat: 1, lon: 1, seen_pos: 900 }, // stale
    ],
  };
  it("parses positioned, fresh aircraft", () => {
    const rows = parseAdsbLolMil(raw);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual(["ae03f6", "PAT171", "84-00171", "BE20", -158.7449, 60.9255, 25000, false, 246, 86, "4724", 6]);
    expect(rows[1][6]).toBe(0);
    expect(rows[1][7]).toBe(true);
    expect(parseAdsbLolMil({} as never)).toEqual([]);
  });
  it("labels with callsign, else registration", () => {
    const fc = milFeatures({ fields: [], rows: parseAdsbLolMil(raw) });
    expect(fc.features.map((f) => f.properties?.label)).toEqual(["PAT171", "15-20781"]);
  });
});

describe("SGP4", () => {
  // Spacetrack Report #3 test case 88888 (near-Earth), WGS-72.
  const epochMs = Date.UTC(1980, 0, 1) + (275.98708465 - 1) * 86_400_000;
  const rec = sgp4init({
    epochMs,
    meanMotion: 16.05824518,
    eccentricity: 0.0086731,
    inclination: 72.8435,
    raan: 115.9689,
    argOfPericenter: 52.6988,
    meanAnomaly: 110.5714,
    bstar: 0.66816e-4,
  });

  it("matches the published reference vectors", () => {
    const ref: Array<[number, [number, number, number], [number, number, number]]> = [
      [0, [2328.97048951, -5995.22076416, 1719.97067261], [2.91207230, -0.98341546, -7.09081703]],
      [360, [2456.10705566, -6071.93853760, 1222.89727783], [2.67938992, -0.44829041, -7.22879231]],
      [720, [2567.56195068, -6112.50384522, 713.96397400], [2.44024599, 0.09810869, -7.31995916]],
      [1440, [2742.55133057, -6079.67144775, -326.38095856], [1.94850229, 1.21106251, -7.35619372]],
    ];
    for (const [t, r, v] of ref) {
      const pv = sgp4(rec, t)!;
      for (let i = 0; i < 3; i++) {
        expect(Math.abs(pv.r[i] - r[i])).toBeLessThan(0.05); // km
        expect(Math.abs(pv.v[i] - v[i])).toBeLessThan(1e-4); // km/s
      }
    }
  });

  it("reports the orbital period and flags deep-space orbits", () => {
    expect(rec.periodMin).toBeCloseTo(1440 / 16.05824518, 0);
    expect(rec.deep).toBe(false);
    const gps = sgp4init({ epochMs: 0, meanMotion: 2.00563, eccentricity: 0.005, inclination: 55, raan: 10, argOfPericenter: 20, meanAnomaly: 30, bstar: 0 });
    expect(gps.deep).toBe(true);
    const p = subPoint(gps, 3600_000)!;
    expect(p.altKm).toBeGreaterThan(19_500);
    expect(p.altKm).toBeLessThan(20_800);
    expect(Math.abs(p.lat)).toBeLessThanOrEqual(55.5);
  });

  it("rejects non-physical elements", () => {
    expect(() => sgp4init({ epochMs: 0, meanMotion: 0, eccentricity: 0, inclination: 0, raan: 0, argOfPericenter: 0, meanAnomaly: 0, bstar: 0 })).toThrow();
    expect(() => sgp4init({ epochMs: 0, meanMotion: 15, eccentricity: 1.2, inclination: 0, raan: 0, argOfPericenter: 0, meanAnomaly: 0, bstar: 0 })).toThrow();
  });

  it("GMST at J2000 is ~280.46°", () => {
    expect((gmst(Date.UTC(2000, 0, 1, 12)) * 180) / Math.PI).toBeCloseTo(280.46, 1);
  });

  it("converts TEME to geodetic", () => {
    const g = temeToGeodetic([0, 0, 6356.752 + 100], 0);
    expect(g.lat).toBeCloseTo(90, 5);
    expect(g.altKm).toBeCloseTo(100, 1);
  });

  it("ISS-like orbit stays within its inclination band at LEO altitude", () => {
    const iss = sgp4init({ epochMs: NOW, meanMotion: 15.4876, eccentricity: 0.00068, inclination: 51.63, raan: 103.97, argOfPericenter: 234.36, meanAnomaly: 125.68, bstar: 8.5e-5 });
    const track = groundTrack(iss, NOW, NOW + 93 * 60_000, 60_000);
    expect(track.length).toBe(94);
    for (const [lon, lat] of track) {
      expect(Math.abs(lat)).toBeLessThanOrEqual(51.8);
      expect(Math.abs(lon)).toBeLessThanOrEqual(180);
    }
    const p = subPoint(iss, NOW)!;
    expect(p.altKm).toBeGreaterThan(400);
    expect(p.altKm).toBeLessThan(440);
    expect(p.speedKms).toBeCloseTo(7.66, 1);
  });
});

describe("CelesTrak GP parsing", () => {
  const gp = (id: number, extra: Partial<CelestrakGp> = {}): CelestrakGp => ({
    OBJECT_NAME: `SAT  ${id}`,
    OBJECT_ID: "1998-067A",
    NORAD_CAT_ID: id,
    EPOCH: "2026-10-07T13:30:47.478528",
    MEAN_MOTION: 15.48762857,
    ECCENTRICITY: 0.00068101,
    INCLINATION: 51.6311,
    RA_OF_ASC_NODE: 103.9669,
    ARG_OF_PERICENTER: 234.3585,
    MEAN_ANOMALY: 125.6769 + id,
    BSTAR: 8.5268073e-5,
    ...extra,
  });

  it("parses OMM epochs with microseconds as UTC", () => {
    expect(parseOmmEpoch("2026-10-07T13:30:47.478528")).toBe(Date.UTC(2026, 9, 7, 13, 30, 47, 479));
    expect(parseOmmEpoch("nonsense")).toBeNull();
  });

  it("parses and validates a record", () => {
    expect(parseGp(gp(25544), "stations")).toMatchObject({ id: 25544, name: "SAT 25544", group: "stations", inclination: 51.6311 });
    expect(parseGp(gp(1, { ECCENTRICITY: 1.5 }), "visual")).toBeNull();
    expect(parseGp(gp(1, { EPOCH: undefined }), "visual")).toBeNull();
  });

  it("merges groups: dedupes ids and identical orbits, applies caps", () => {
    const data = mergeGroups([
      { group: "stations", records: [gp(1), gp(2, { MEAN_ANOMALY: 125.6769 + 1 }), gp(3)], cap: 10 },
      { group: "visual", records: [gp(1), gp(4), gp(5), gp(6)], cap: 2 },
    ]);
    expect(data.sats.map((s) => s.id)).toEqual([1, 3, 4, 5]);
    expect(data.groups).toEqual({ stations: 2, gps: 0, visual: 2 });
  });

  it("propagates prepared sats into features and an orbit track", () => {
    const prepared = prepareSats(mergeGroups([{ group: "stations", records: [gp(1), gp(2)], cap: 10 }]).sats);
    const fc = satFeatures(prepared, NOW, 2);
    expect(fc.features).toHaveLength(2);
    expect(fc.features[1].properties).toMatchObject({ id: 2, selected: true, periodMin: 93 });
    const track = satTrackFeatures(prepared[0], NOW, "#fff");
    expect(track.features.map((f) => f.properties?.part)).toEqual(["past", "future"]);
  });
});
