import { describe, expect, it } from "vitest";
import { isDaylight, issFeatures, parseIssPosition, parseTrack, splitAntimeridian, trackTimestamps, type IssData } from "@/layers/iss";
import { auroraFeatures, parseOvation } from "@/layers/aurora";

// Shape of https://api.wheretheiss.at/v1/satellites/25544?units=kilometers
const ISS_RAW = {
  name: "iss",
  id: 25544,
  latitude: 7.7884773864143,
  longitude: 8.6459949226303,
  altitude: 423.86097707948,
  velocity: 27565.248630164,
  visibility: "daylight",
  footprint: 4527.0544487161,
  timestamp: 1791352126,
  daynum: 2461320.7421991,
  solar_lat: -5.5141295048765,
  solar_lon: 89.779695234947,
  units: "kilometers",
};

describe("ISS position", () => {
  it("parses a wheretheiss.at record", () => {
    const p = parseIssPosition(ISS_RAW)!;
    expect(p.lat).toBeCloseTo(7.788, 3);
    expect(p.lon).toBeCloseTo(8.646, 3);
    expect(p.altKm).toBeCloseTo(423.86, 1);
    expect(p.speedKmh).toBeCloseTo(27565.2, 0);
    expect(p.visibility).toBe("daylight");
    expect(p.time).toBe(new Date(1791352126 * 1000).toISOString());
    expect(p.groundDaylight).toBe(true);
  });

  it("converts miles and rejects bad records", () => {
    const p = parseIssPosition({ ...ISS_RAW, units: "miles", altitude: 260, velocity: 17000 })!;
    expect(p.altKm).toBeCloseTo(418.4, 0);
    expect(parseIssPosition({ ...ISS_RAW, latitude: "x" })).toBeNull();
    expect(parseIssPosition({ ...ISS_RAW, latitude: 123 })).toBeNull();
    expect(parseIssPosition(null)).toBeNull();
  });

  it("day/night from the sub-solar point", () => {
    expect(isDaylight(0, 0, 0, 0)).toBe(true);
    expect(isDaylight(0, 180, 0, 0)).toBe(false);
    expect(isDaylight(80, 0, -23, 0)).toBe(false);
  });

  it("builds a point feature for the map", () => {
    const fc = issFeatures({ position: parseIssPosition(ISS_RAW)!, track: null });
    expect(fc.point.features).toHaveLength(1);
    expect((fc.point.features[0].geometry as GeoJSON.Point).coordinates).toEqual([ISS_RAW.longitude, ISS_RAW.latitude]);
    expect(fc.point.features[0].properties).toMatchObject({ visibility: "daylight", groundDaylight: true });
    expect(fc.track.features).toHaveLength(0);
  });
});

describe("ISS ground track", () => {
  it("chunks ±90 min at 3-minute steps into requests of ≤10 timestamps", () => {
    const chunks = trackTimestamps(1_791_352_126);
    const all = chunks.flat();
    expect(all).toHaveLength(61);
    expect(chunks.every((c) => c.length <= 10)).toBe(true);
    expect(all[all.length - 1] - all[0]).toBe(180 * 60);
    expect(all[1] - all[0]).toBe(180);
  });

  it("parses /positions responses, skipping bad rows, sorted by time", () => {
    const rows = parseTrack([
      { ...ISS_RAW, timestamp: 200, longitude: 10, latitude: 1 },
      { ...ISS_RAW, timestamp: 100, longitude: 190, latitude: 2 },
      { ...ISS_RAW, timestamp: 150, latitude: null },
    ]);
    expect(rows).toEqual([
      [-170, 2, 100],
      [10, 1, 200],
    ]);
    expect(parseTrack({ error: "x" })).toEqual([]);
  });

  it("splits lines at the antimeridian with an interpolated crossing", () => {
    const lines = splitAntimeridian([
      [170, 0],
      [-170, 10],
      [-160, 12],
    ]);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toEqual([
      [170, 0],
      [180, 5],
    ]);
    expect(lines[1][0]).toEqual([-180, 5]);
    expect(splitAntimeridian([[0, 0], [10, 1]])).toHaveLength(1);
  });

  it("separates past and upcoming track at the current position", () => {
    const now = 1000;
    const data: IssData = {
      position: { ...parseIssPosition({ ...ISS_RAW, timestamp: now, longitude: 0, latitude: 0 })! },
      track: {
        computedAt: new Date().toISOString(),
        points: [
          [-20, -5, now - 360],
          [-10, -2, now - 180],
          [10, 2, now + 180],
          [20, 5, now + 360],
        ],
      },
    };
    const { track } = issFeatures(data);
    const past = track.features.find((f) => f.properties?.part === "past")!.geometry as GeoJSON.MultiLineString;
    const future = track.features.find((f) => f.properties?.part === "future")!.geometry as GeoJSON.MultiLineString;
    expect(past.coordinates[0].at(-1)).toEqual([0, 0]);
    expect(future.coordinates[0][0]).toEqual([0, 0]);
    expect(future.coordinates[0]).toHaveLength(3);
  });
});

describe("OVATION aurora grid", () => {
  const raw = {
    "Observation Time": "2026-10-07T05:34:00Z",
    "Forecast Time": "2026-10-07T06:46:00Z",
    "Data Format": "[Longitude, Latitude, Aurora]",
    coordinates: [
      [0, -90, 1],
      [10, 65, 12],
      [200, 66, 45],
      [359, 70, 9],
      [180, 67, 10],
      ["x", 1, 50],
      [5, 95, 50],
    ],
  };

  it("keeps cells ≥ 10% and maps longitudes to −180..180", () => {
    const d = parseOvation(raw);
    expect(d.cells).toEqual([
      [10, 65, 12],
      [-160, 66, 45],
      [180, 67, 10],
    ]);
    expect(d.maxProbability).toBe(45);
    expect(d.forecastTime).toBe("2026-10-07T06:46:00.000Z");
    expect(d.observationTime).toBe("2026-10-07T05:34:00.000Z");
    expect(d.minProbability).toBe(10);
  });

  it("honours a custom threshold and builds point features", () => {
    const d = parseOvation(raw, 40);
    expect(d.cells).toHaveLength(1);
    const fc = auroraFeatures(d);
    expect(fc.features[0].properties).toEqual({ p: 45 });
    expect((fc.features[0].geometry as GeoJSON.Point).coordinates).toEqual([-160, 66]);
  });

  it("rejects an unrecognised payload and tolerates missing times", () => {
    expect(() => parseOvation({ foo: 1 })).toThrow(/coordinates/);
    expect(parseOvation({ coordinates: [] }).forecastTime).toBeNull();
  });
});
