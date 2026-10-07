import { describe, expect, it } from "vitest";
import {
  airportCodeQuery,
  coordinateResult,
  mergePlaces,
  nameMatchScore,
  parseCoordinates,
  parsePhoton,
  photonExtentToBBox,
  placeView,
  rankLocalPlaces,
  type LocalCandidate,
  type PlaceResult,
} from "@/lib/geo/place-search";
import { findRegionId, searchPlacesLocal } from "@/lib/geo/place-index";
import { geocode, takeSlot } from "@/lib/geo/geocode";

describe("coordinate parsing", () => {
  it("reads decimal lat, lon in several spellings", () => {
    expect(parseCoordinates("48.85, 2.35")).toEqual({ lat: 48.85, lon: 2.35 });
    expect(parseCoordinates("48.85 2.35")).toEqual({ lat: 48.85, lon: 2.35 });
    expect(parseCoordinates(" -33.8688,151.2093 ")).toEqual({ lat: -33.8688, lon: 151.2093 });
    expect(parseCoordinates("48,85; 2,35")).toEqual({ lat: 48.85, lon: 2.35 });
    expect(parseCoordinates("40.7°, -74.0°")).toEqual({ lat: 40.7, lon: -74 });
  });
  it("reads hemisphere letters and DMS", () => {
    expect(parseCoordinates("33.87S 151.21E")).toEqual({ lat: -33.87, lon: 151.21 });
    expect(parseCoordinates("74.0 W, 40.7 N")).toEqual({ lat: 40.7, lon: -74 });
    const dms = parseCoordinates(`48°51'24"N 2°21'03"E`)!;
    expect(dms.lat).toBeCloseTo(48.8567, 3);
    expect(dms.lon).toBeCloseTo(2.3508, 3);
  });
  it("rejects out-of-range values and non-coordinates", () => {
    expect(parseCoordinates("95.1, 10.2")).toBeNull();
    expect(parseCoordinates("45.1, 190.5")).toBeNull();
    expect(parseCoordinates("10 20")).toBeNull(); // bare integers are ambiguous
    expect(parseCoordinates("Paris")).toBeNull();
    expect(parseCoordinates("1600 Pennsylvania Avenue")).toBeNull();
  });
  it("builds a readable coordinates result", () => {
    const r = coordinateResult({ lat: -33.87, lon: 151.21 });
    expect(r).toMatchObject({ kind: "coordinates", source: "input", lat: -33.87, lon: 151.21 });
    expect(r.name).toBe("33.8700° S, 151.2100° E");
  });
  it("recognises airport-code shaped queries", () => {
    expect(airportCodeQuery("jfk")).toBe("JFK");
    expect(airportCodeQuery("KJFK")).toBe("KJFK");
    expect(airportCodeQuery("JFK airport")).toBeNull();
  });
});

const cand = (c: Partial<LocalCandidate> & Pick<LocalCandidate, "kind" | "name">): LocalCandidate => ({
  keys: [c.name.toLowerCase()],
  context: [],
  detail: "",
  lat: 0,
  lon: 0,
  bbox: null,
  countryCode: null,
  regionId: null,
  weight: 0,
  ...c,
});

describe("local ranking", () => {
  const list = [
    cand({ kind: "city", name: "Paris", context: ["france", "fr", "ile de france"], weight: 11_000_000 }),
    cand({ kind: "city", name: "Paris", keys: ["paris"], context: ["united states", "us", "texas", "tx"], weight: 25_000, lat: 33.66 }),
    cand({ kind: "state", name: "Hanover", keys: ["hanover parish"], weight: 0 }),
    cand({ kind: "country", name: "Georgia", codes: ["geo"], weight: 3_700_000 }),
    cand({ kind: "state", name: "Georgia", codes: ["ga"], regionId: 2079 }),
    cand({ kind: "airport", name: "John F. Kennedy International Airport", keys: ["john f kennedy international airport"], codes: ["jfk", "kjfk"], weight: 1_000_000 }),
    cand({ kind: "airport", name: "Lakefront Airport", codes: ["new"], weight: 10_000 }),
    cand({ kind: "city", name: "New York", weight: 19_000_000 }),
  ];
  it("scores exact > prefix > word prefix > substring", () => {
    expect(nameMatchScore("paris", "paris")).toBeGreaterThan(nameMatchScore("par", "paris"));
    expect(nameMatchScore("par", "paris")).toBeGreaterThan(nameMatchScore("york", "new york"));
    expect(nameMatchScore("york", "new york")).toBeGreaterThan(nameMatchScore("ork", "new york"));
    expect(nameMatchScore("xyz", "paris")).toBe(0);
  });
  it("prefers bigger places and drops weak partial matches", () => {
    const r = rankLocalPlaces("Paris", list);
    expect(r.map((x) => x.name)).toEqual(["Paris", "Paris"]);
    expect(r[0].lat).toBe(0); // the larger Paris first; "Hanover Parish" is cut
  });
  it("supports 'name, qualifier' queries", () => {
    const r = rankLocalPlaces("paris, tx", list);
    expect(r).toHaveLength(1);
    expect(r[0].lat).toBe(33.66);
  });
  it("ranks countries above same-named states, both shown", () => {
    expect(rankLocalPlaces("georgia", list).map((x) => x.kind)).toEqual(["country", "state"]);
  });
  it("puts exact IATA codes first; lowercase short codes don't beat names", () => {
    expect(rankLocalPlaces("JFK", list)[0].name).toMatch(/Kennedy/);
    expect(rankLocalPlaces("jfk", list)[0].name).toMatch(/Kennedy/);
    expect(rankLocalPlaces("new", list)[0].name).toBe("New York");
    expect(rankLocalPlaces("NEW", list)[0].name).toBe("Lakefront Airport");
  });
});

describe("bundled gazetteer places", () => {
  it("finds countries, states with region ids, cities and airports", () => {
    expect(searchPlacesLocal("Japan")[0]).toMatchObject({ kind: "country", countryCode: "JP" });
    const ca = searchPlacesLocal("California")[0];
    expect(ca).toMatchObject({ kind: "state", countryCode: "US", name: "California" });
    expect(ca.regionId).toBeGreaterThan(0);
    expect(ca.bbox).not.toBeNull();
    expect(searchPlacesLocal("JFK")[0]).toMatchObject({ kind: "airport", countryCode: "US" });
    expect(searchPlacesLocal("Heathrow")[0].detail).toMatch(/LHR/);
    expect(searchPlacesLocal("Sao Paulo")[0]).toMatchObject({ kind: "city", name: "São Paulo" });
    expect(searchPlacesLocal("europe")[0]).toMatchObject({ kind: "continent" });
  });
  it("matches online admin-1 names to region ids", () => {
    expect(findRegionId("Bavaria", "DE")).toBe(searchPlacesLocal("Bavaria")[0].regionId);
    expect(findRegionId("Kyiv Oblast", "UA")).not.toBeNull();
    expect(findRegionId("Atlantis", "US")).toBeNull();
  });
});

const PHOTON = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: { osm_type: "W", osm_id: 5013364, osm_key: "man_made", osm_value: "tower", type: "house", housenumber: "5", name: "Eiffel Tower", street: "Avenue Anatole France", district: "Paris", city: "Paris", state: "Île-de-France", country: "France", countrycode: "FR", extent: [2.2933, 48.859, 2.2957, 48.8575] },
      geometry: { type: "Point", coordinates: [2.2945, 48.8583] },
    },
    {
      type: "Feature",
      properties: { osm_type: "R", osm_id: 2145268, osm_key: "place", osm_value: "state", type: "state", name: "Bavaria", country: "Germany", countrycode: "DE", extent: [8.9764, 50.5647, 13.8396, 47.2701] },
      geometry: { type: "Point", coordinates: [11.4039, 48.9468] },
    },
    {
      type: "Feature",
      properties: { osm_type: "N", osm_id: 1, osm_key: "aeroway", osm_value: "aerodrome", type: "house", name: "Tegel", city: "Berlin", country: "Germany", countrycode: "DE" },
      geometry: { type: "Point", coordinates: [13.29, 52.56] },
    },
    { type: "Feature", properties: { osm_type: "N", osm_id: 2, type: "house", housenumber: "10", street: "Downing Street", city: "London", country: "United Kingdom", countrycode: "GB" }, geometry: { type: "Point", coordinates: [-0.1276, 51.5034] } },
    { type: "Feature", properties: { osm_type: "R", osm_id: 3, type: "country", name: "Japan", countrycode: "JP", extent: [122.9, 45.6, 153.99, 20.4] }, geometry: { type: "Point", coordinates: [139.2, 36.6] } },
    { type: "Feature", properties: { type: "city", name: "Broken" }, geometry: { type: "Point", coordinates: [200, 0] } },
    { type: "Feature", properties: { type: "city" }, geometry: { type: "Point", coordinates: [1, 1] } },
  ],
};

describe("Photon response → results", () => {
  const r = parsePhoton(PHOTON);
  it("maps kinds, names, details and bboxes", () => {
    expect(r.map((x) => x.kind)).toEqual(["poi", "state", "airport", "address", "country"]);
    expect(r[0]).toMatchObject({ name: "Eiffel Tower", countryCode: "FR", source: "photon", lat: 48.8583, lon: 2.2945 });
    expect(r[0].detail).toBe("Place · 5 Avenue Anatole France, Paris, France");
    expect(r[1].bbox).toEqual([8.9764, 47.2701, 13.8396, 50.5647]);
    expect(r[3].name).toBe("10 Downing Street");
  });
  it("skips malformed features and tolerates junk", () => {
    expect(r.some((x) => x.name === "Broken")).toBe(false);
    expect(parsePhoton(null)).toEqual([]);
    expect(parsePhoton({ features: "nope" })).toEqual([]);
    expect(photonExtentToBBox([1, 2, 3])).toBeNull();
  });
});

describe("camera choice", () => {
  const base = { lat: 10, lon: 20, bbox: [10, 0, 30, 20] as [number, number, number, number] };
  it("fits bboxes for countries and states, with caps", () => {
    expect(placeView({ ...base, kind: "country" })).toMatchObject({ bbox: base.bbox, zoom: 6 });
    expect(placeView({ ...base, kind: "state" })).toMatchObject({ bbox: base.bbox, zoom: 8 });
  });
  it("uses zoom ~10 for cities and ~16 for addresses / POIs", () => {
    expect(placeView({ ...base, kind: "city" })).toEqual({ lon: 20, lat: 10, zoom: 10 });
    expect(placeView({ ...base, kind: "address", bbox: null })).toEqual({ lon: 20, lat: 10, zoom: 16 });
    expect(placeView({ ...base, kind: "poi", bbox: [20, 10, 20.001, 10.001] })).toEqual({ lon: 20, lat: 10, zoom: 16 });
  });
  it("fits large POIs (parks, lakes) instead of zooming to a point", () => {
    expect(placeView({ ...base, kind: "poi", bbox: [20, 10, 20.3, 10.2] }).bbox).toEqual([20, 10, 20.3, 10.2]);
  });
  it("ignores degenerate bboxes", () => {
    expect(placeView({ ...base, kind: "country", bbox: [30, 0, 10, 20] })).toEqual({ lon: 20, lat: 10, zoom: 4 });
  });
});

describe("merging local and online results", () => {
  const p = (x: Partial<PlaceResult> & Pick<PlaceResult, "kind" | "name">): PlaceResult => ({
    id: `${x.source ?? "local"}:${x.name}:${x.lat ?? 0}`,
    detail: "",
    lat: 0,
    lon: 0,
    bbox: null,
    countryCode: null,
    regionId: null,
    source: "local",
    ...x,
  });
  it("drops online duplicates of local places and keeps new ones", () => {
    const local = [p({ kind: "city", name: "Paris", lat: 48.86, lon: 2.35 }), p({ kind: "country", name: "France", countryCode: "FR" })];
    const online = [
      p({ kind: "city", name: "Paris", lat: 48.85, lon: 2.34, source: "photon" }),
      p({ kind: "country", name: "France", countryCode: "FR", source: "photon" }),
      p({ kind: "city", name: "Paris", lat: 33.66, lon: -95.55, source: "photon" }),
      p({ kind: "poi", name: "Eiffel Tower", lat: 48.858, source: "photon" }),
    ];
    const m = mergePlaces(local, online);
    expect(m.map((x) => `${x.source}:${x.name}`)).toEqual(["local:Paris", "local:France", "photon:Paris", "photon:Eiffel Tower"]);
    expect(mergePlaces(local, online, 3)).toHaveLength(3);
  });
});

describe("geocode proxy", () => {
  it("caches per query and enriches states with region ids", async () => {
    let calls = 0;
    const fake = (async (url: string | URL | Request, init?: RequestInit) => {
      calls++;
      expect(String(url)).toContain("photon.komoot.io/api/?q=Bavaria+test");
      expect(String(url)).toContain("lang=en");
      expect((init?.headers as Record<string, string>)["User-Agent"]).toMatch(/^WorldView\//);
      return new Response(JSON.stringify(PHOTON));
    }) as typeof fetch;
    const a = await geocode("Bavaria test", "t1", fake);
    const b = await geocode("  bavaria   TEST ", "t1", fake);
    expect(calls).toBe(1);
    expect(a.cached).toBe(false);
    expect(b.cached).toBe(true);
    expect(a.attribution).toMatch(/Photon.*OpenStreetMap/);
    const bavaria = a.results.find((x) => x.name === "Bavaria")!;
    expect(bavaria.regionId).toBe(findRegionId("Bavaria", "DE"));
  });
  it("skips short queries", async () => {
    const r = await geocode("ab", "t2", (() => {
      throw new Error("should not fetch");
    }) as unknown as typeof fetch);
    expect(r.results).toEqual([]);
  });
  it("sliding-window rate limit", () => {
    const log: number[] = [];
    expect(takeSlot(log, 2, 0)).toBe(true);
    expect(takeSlot(log, 2, 10)).toBe(true);
    expect(takeSlot(log, 2, 20)).toBe(false);
    expect(takeSlot(log, 2, 60_011)).toBe(true);
  });
});
