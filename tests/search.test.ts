import { describe, expect, it } from "vitest";
import { parseIntent } from "@/lib/search/intent";
import { searchLocations } from "@/lib/search";
import { nightPolygon, sunPosition } from "@/components/globe/terminator";

describe("search intent", () => {
  it("extracts magnitude, category and time", () => {
    const i = parseIntent("Show earthquakes over magnitude 5 in the last six hours");
    expect(i.categories).toEqual(["EARTHQUAKE"]);
    expect(i.minMagnitude).toBe(5);
    expect(i.range).toBe("6h");
  });
  it("leaves the place phrase for resolution", () => {
    expect(parseIntent("What is happening in Europe?").placePhrase).toBe("europe");
    expect(parseIntent("California fires")).toMatchObject({ categories: ["FIRE"], placePhrase: "california" });
  });
});

describe("location search", () => {
  it("finds countries, regions and cities", () => {
    expect(searchLocations("India")[0]).toMatchObject({ kind: "country", code: "IN" });
    expect(searchLocations("europe")[0]).toMatchObject({ kind: "region", name: "Europe" });
    expect(searchLocations("Ukraine")[0].code).toBe("UA");
    expect(searchLocations("Tokyo").some((l) => l.kind === "city")).toBe(true);
    expect(searchLocations("California")[0]).toMatchObject({ kind: "state", code: "US" });
  });
});

describe("day/night terminator", () => {
  it("places the subsolar point near the equator at the equinox", () => {
    const s = sunPosition(new Date("2026-03-20T12:00:00Z"));
    expect(Math.abs(s.lat)).toBeLessThan(1);
    expect(Math.abs(s.lon)).toBeLessThan(5);
  });
  it("builds a closed polygon", () => {
    const ring = nightPolygon(new Date("2026-10-04T00:00:00Z")).geometry.coordinates[0];
    expect(ring[0]).toEqual(ring[ring.length - 1]);
  });
});
