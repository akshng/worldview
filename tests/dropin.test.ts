import { describe, expect, it } from "vitest";
import {
  DROP_PITCH,
  DROP_ZOOM,
  commonsGeosearchUrl,
  dropInCamera,
  formatCoords,
  formatElevation,
  nearestLocalPlace,
  normalizeBearing,
  orbitStep,
  panoramaxSearchUrl,
  parseCommons,
  parsePanoramax,
  plainText,
  terrariumElevation,
} from "@/components/dropin/logic";
import { buildingsLayer, terrainSource } from "@/components/globe/style";

describe("drop-in camera", () => {
  it("flies to street level keeping the current heading", () => {
    const c = dropInCamera({ lon: -73.9855, lat: 40.758 }, 390);
    expect(c).toEqual({ center: [-73.9855, 40.758], zoom: DROP_ZOOM, bearing: 30, pitch: DROP_PITCH });
  });
  it("clamps latitude and wraps longitude", () => {
    const c = dropInCamera({ lon: 190, lat: 89.9 }, 0);
    expect(c.center[0]).toBeCloseTo(-170);
    expect(c.center[1]).toBe(85);
  });
  it("normalizes bearings", () => {
    expect(normalizeBearing(180)).toBe(-180);
    expect(normalizeBearing(-190)).toBe(170);
    expect(normalizeBearing(-360)).toBe(0);
  });
  it("orbits slowly and never jumps after a stall", () => {
    expect(orbitStep(0, 1000, 4)).toBeCloseTo(0.4); // dt capped at 100 ms
    expect(orbitStep(179.9, 50, 4)).toBeCloseTo(-179.9);
    expect(orbitStep(10, -5)).toBe(10);
  });
});

describe("readouts", () => {
  it("formats coordinates with hemispheres", () => {
    expect(formatCoords(40.758, -73.9855)).toBe("40.7580° N, 73.9855° W");
    expect(formatCoords(-33.8688, 151.2093, 2)).toBe("33.87° S, 151.21° E");
  });
  it("removes the terrain exaggeration from elevations", () => {
    expect(formatElevation(4303.97, 1.3)).toBe("3,311 m");
    expect(formatElevation(null, 1.3)).toBeNull();
    expect(formatElevation(Number.NaN, 1.3)).toBeNull();
  });
  it("decodes terrarium pixels", () => {
    expect(terrariumElevation(128, 0, 0)).toBe(0);
    expect(terrariumElevation(129, 44, 128)).toBeCloseTo(300.5);
  });
  it("picks the most local named place nearby", () => {
    const at = { lat: 40.758, lon: -73.9855 };
    const places = [
      { name: "New York", cls: "city", lat: 40.7128, lon: -74.006 },
      { name: "Midtown", cls: "suburb", lat: 40.7549, lon: -73.984 },
      { name: "Theater District", cls: "neighbourhood", lat: 40.759, lon: -73.986 },
      { name: "Far Hamlet", cls: "hamlet", lat: 41.5, lon: -73.9 },
      { name: "Unlabelled", cls: null, lat: 40.758, lon: -73.9855 },
    ];
    expect(nearestLocalPlace(places, at)).toBe("Theater District");
    expect(nearestLocalPlace(places.slice(0, 1), at)).toBe("New York");
    expect(nearestLocalPlace([], at)).toBeNull();
  });
});

describe("photos", () => {
  const origin = { lat: 40.758, lon: -73.9855 };
  it("builds a keyless Commons geosearch + imageinfo request", () => {
    const u = new URL(commonsGeosearchUrl(40.758, -73.9855, 1000));
    expect(u.hostname).toBe("commons.wikimedia.org");
    expect(u.searchParams.get("generator")).toBe("geosearch");
    expect(u.searchParams.get("ggscoord")).toBe("40.75800|-73.98550");
    expect(u.searchParams.get("ggsnamespace")).toBe("6");
    expect(u.searchParams.get("ggsradius")).toBe("1000");
    expect(u.searchParams.get("origin")).toBe("*");
    expect(u.searchParams.get("prop")).toContain("imageinfo");
  });
  it("parses Commons pages, strips HTML credits and sorts by distance", () => {
    const body = {
      query: {
        pages: [
          {
            pageid: 2,
            title: "File:Far away.jpg",
            coordinates: [{ lat: 40.765, lon: -73.98 }],
            imageinfo: [{ thumburl: "https://upload.wikimedia.org/far.jpg", descriptionurl: "https://commons.wikimedia.org/wiki/File:Far_away.jpg", extmetadata: { LicenseShortName: { value: "CC BY-SA 4.0" } } }],
          },
          {
            pageid: 1,
            title: "File:Times Square.jpg",
            coordinates: [{ lat: 40.758, lon: -73.9855 }],
            imageinfo: [
              {
                thumburl: "https://upload.wikimedia.org/ts.jpg",
                extmetadata: { Artist: { value: '<a href="//commons.wikimedia.org/wiki/User:X">Jane &amp; Co</a>' }, LicenseShortName: { value: "CC0" } },
              },
            ],
          },
          { pageid: 3, title: "File:Document.pdf", coordinates: [{ lat: 40.758, lon: -73.9855 }], imageinfo: [{ thumburl: "https://x/doc.jpg" }] },
          { pageid: 4, title: "File:No coords.jpg", imageinfo: [{ thumburl: "https://x/n.jpg" }] },
        ],
      },
    };
    const photos = parseCommons(body, origin);
    expect(photos.map((p) => p.id)).toEqual(["commons:1", "commons:2"]);
    expect(photos[0]).toMatchObject({ title: "Times Square", credit: "Jane & Co · CC0 · Wikimedia Commons", distanceM: 0 });
    expect(photos[0].href).toBe("https://commons.wikimedia.org/wiki/File%3ATimes_Square.jpg");
    expect(photos[1].credit).toBe("Unknown author · CC BY-SA 4.0 · Wikimedia Commons");
    expect(photos[1].distanceM).toBeGreaterThan(800);
    expect(parseCommons(null, origin)).toEqual([]);
    expect(parseCommons({ batchcomplete: true }, origin)).toEqual([]);
  });
  it("strips markup", () => {
    expect(plainText("<b>A</b>&nbsp;&quot;B&quot;  <i>C</i>")).toBe('A "B" C');
    expect(plainText(undefined)).toBe("");
  });
  it("builds a Panoramax bbox search and parses STAC items", () => {
    const u = panoramaxSearchUrl(40.758, -73.9855, 300);
    expect(u).toMatch(/^https:\/\/api\.panoramax\.xyz\/api\/search\?bbox=-73\.989\d*,40\.755\d*,-73\.981\d*,40\.760\d*&limit=8$/);
    const photos = parsePanoramax(
      {
        features: [
          {
            id: "abc",
            geometry: { type: "Point", coordinates: [-73.9856, 40.7586] },
            assets: { thumb: { href: "https://panoramax.ign.fr/api/pictures/abc/thumb.jpg" } },
            properties: { datetime: "2026-04-18T10:00:00Z", license: "CC-BY-SA-4.0", "geovisio:producer": "someone" },
          },
          { id: "nothumb", geometry: { type: "Point", coordinates: [0, 0] }, assets: {} },
        ],
      },
      origin,
    );
    expect(photos).toHaveLength(1);
    expect(photos[0]).toMatchObject({
      id: "panoramax:abc",
      source: "panoramax",
      title: "Street-level photo, 2026-04-18",
      credit: "someone · CC-BY-SA-4.0 · Panoramax",
      href: "https://api.panoramax.xyz/#focus=pic&pic=abc",
      date: "2026-04-18",
    });
    expect(photos[0].distanceM).toBeLessThan(100);
  });
});

describe("drop-in map layers", () => {
  it("uses keyless terrarium terrain tiles with attribution", () => {
    const t = terrainSource();
    expect(t.type).toBe("raster-dem");
    expect(t.encoding).toBe("terrarium");
    expect(t.tiles[0]).toBe("https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png");
    expect(t.attribution).toContain("Mapzen/AWS Open Data");
  });
  it("extrudes OpenFreeMap buildings only from zoom 14", () => {
    const l = buildingsLayer();
    expect(l.type).toBe("fill-extrusion");
    expect(l).toMatchObject({ source: "omt", "source-layer": "building", minzoom: 14 });
    expect(JSON.stringify(l)).toContain("render_height");
    expect(JSON.stringify(l)).toContain("render_min_height");
  });
});
