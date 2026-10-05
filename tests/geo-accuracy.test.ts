import { describe, expect, it } from "vitest";
import { countryFromPlaceText, placesInText } from "@/lib/geo/headline-places";
import { enrichGeo, refineNewsLocation } from "@/lib/ingestion/pipeline";
import { convexHull, interiorPoint, pointInPolygon, simplifyRing } from "@/lib/geo/math";
import { polygonCentroid } from "@/data-sources/weather/parser";
import { EventCandidateSchema } from "@/types/events";
import { candidate, source } from "./helpers";

const news = (title: string, lat: number, lon: number, locationName: string) =>
  EventCandidateSchema.parse(
    candidate({
      type: "CONFLICT",
      title,
      latitude: lat,
      longitude: lon,
      geoPrecision: "city",
      locationName,
      source: source({ id: "gdelt:x", dataSourceId: "gdelt", externalId: "x", sourceType: "NEWS_MEDIA", assertion: "MEDIA_REPORT", sourceUrl: "https://n.example/x", title, titleIsDerived: true }),
    }),
  );

describe("headline place extraction", () => {
  it("finds cued countries and cities", () => {
    const p = placesInText("Israeli army says it killed assailant in southern syria");
    expect(p.map((x) => [x.country.code, x.cued])).toEqual([["SY", true]]);
    const q = placesInText("Floods hit Karachi as monsoon rains lash Pakistan");
    expect(q.map((x) => x.city?.name ?? x.country.code)).toEqual(["Karachi", "PK"]);
  });
  it("recognises US towns that share a famous city's name", () => {
    const p = placesInText("2 killed 35 injured mass shooting vienna georgia");
    expect(p[0].country.code).toBe("US");
    expect(p[0].cued).toBe(true);
    const c = news("2 killed 35 injured mass shooting vienna georgia", 48.2, 16.37, "Vienna, Wien, Austria");
    const r = refineNewsLocation(c);
    expect(r.candidate.country).toBe("US");
    expect(r.candidate.geoPrecision).toBe("region");
    expect(r.candidate.latitude).toBeGreaterThan(30);
    expect(r.candidate.latitude).toBeLessThan(35.5); // Georgia (US)
    expect(placesInText("flooding in paris texas")[0].name).toBe("Paris, Texas");
    expect(placesInText("snow closes roads in moscow north dakota")[0]?.country.code ?? "US").toBe("US");
  });

  it("handles possessives lost in URL slugs", () => {
    expect(placesInText("Us withdraws b 1 bomber aircraft from uks fairford base").map((p) => [p.country.code, p.cued])).toContainEqual(["GB", true]);
    expect(placesInText("Iran war news yemens government declares operation").map((p) => p.country.code)).toContain("YE");
  });

  it("ignores ambiguous words and demonyms", () => {
    expect(placesInText("Nice weather lifts mobile sales in March")).toEqual([]);
    expect(placesInText("Israeli army says it killed assailant").length).toBe(0);
  });
});

describe("GDELT location correction", () => {
  it("moves a story to the place its headline names when the geocode disagrees", () => {
    const c = news("Israeli army says it killed assailant in southern syria", 31.7667, 35.2333, "Jerusalem, Israel (general), Israel");
    const r = refineNewsLocation(c);
    expect(r.candidate.country).toBe("SY");
    expect(r.candidate.geoPrecision).toBe("country");
    expect(r.note?.method).toBe("headline");
  });
  it("keeps the geocode when the headline agrees", () => {
    const c = news("Police clash with protesters in Paris over pension reform", 48.85, 2.35, "Paris, France");
    expect(refineNewsLocation(c).candidate).toBe(c);
  });
  it("flags but does not move when the headline mentions a place without a locative cue", () => {
    const c = news("Germany says talks with Iran stalled", 52.52, 13.4, "Berlin, Germany");
    const r = refineNewsLocation(c);
    expect(r.candidate.latitude).toBe(52.52); // Germany mentioned → agrees
    const d = news("Iran warns Washington over sanctions", 48.85, 2.35, "Paris, France");
    expect(refineNewsLocation(d).note?.method).toBe("unverified-geocode");
  });
});

describe("offshore events", () => {
  it("reads the country the source names", () => {
    expect(countryFromPlaceText("120 km E of Miyako, Japan")?.code).toBe("JP");
    expect(countryFromPlaceText("off the coast of Oregon")?.code).toBe("US");
    expect(countryFromPlaceText("5 km N of Ridgecrest, CA")?.code).toBe("US");
    expect(countryFromPlaceText("South Sandwich Islands region")).toBeNull();
  });
  it("associates far-offshore quakes with the named country and explains why", () => {
    const c = EventCandidateSchema.parse(candidate({ latitude: 44.65, longitude: -128.79, locationName: "off the coast of Oregon" }));
    const g = enrichGeo(c);
    expect(g.country).toBe("US");
    expect(g.note?.method).toBe("source-text");
  });
});

describe("area geometry", () => {
  // A U-shaped (concave) warning polygon whose vertex-mean lies outside it.
  const U: [number, number][][] = [[[0, 0], [10, 0], [10, 10], [8, 10], [8, 2], [2, 2], [2, 10], [0, 10], [0, 0]]];
  it("picks a representative point inside concave polygons", () => {
    const [x, y] = interiorPoint(U);
    expect(pointInPolygon(x, y, U)).toBe(true);
    const [cx, cy] = polygonCentroid({ type: "Polygon", coordinates: U })!;
    expect(pointInPolygon(cx, cy, U)).toBe(true);
  });
  it("builds hulls and simplifies rings without breaking closure", () => {
    const hull = convexHull([[0, 0], [1, 0], [0, 1], [1, 1], [0.5, 0.5]])!;
    expect(hull[0]).toEqual(hull[hull.length - 1]);
    expect(hull.length).toBe(5);
    const ring: [number, number][] = Array.from({ length: 200 }, (_, i) => [Math.cos((i / 199) * 2 * Math.PI), Math.sin((i / 199) * 2 * Math.PI)]);
    const s = simplifyRing(ring, 0.01, 50);
    expect(s.length).toBeLessThanOrEqual(50);
    expect(s[0]).toEqual(s[s.length - 1]);
  });
});
