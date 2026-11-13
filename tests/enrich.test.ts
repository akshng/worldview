import { describe, expect, it } from "vitest";
import {
  formatPagerRange,
  hasImpactData,
  isUsgsEventId,
  mmiColor,
  mmiRoman,
  mmiShaking,
  parseMmiContours,
  parsePagerAlerts,
  parsePagerExposures,
  parseUsgsDetail,
  safeUsgsUrl,
  usgsEventIdFrom,
} from "@/lib/enrich/usgs";
import {
  compass,
  parseFlood,
  parseForecast,
  parseLatLon,
  parseMarine,
  roundCoord,
  wantsWeather,
  weatherCode,
  weatherKey,
} from "@/lib/enrich/weather";
import { TtlCache, UpstreamError } from "@/lib/enrich/server";

const P = "https://earthquake.usgs.gov/product";

const DETAIL = {
  type: "Feature",
  id: "us7000twg9",
  properties: {
    mag: 6.1,
    title: "M 6.1 - 144 km SE of Hasaki, Japan",
    url: "https://earthquake.usgs.gov/earthquakes/eventpage/us7000twg9",
    felt: 39,
    cdi: 4.2,
    mmi: 0,
    alert: "green",
    tsunami: 0,
    products: {
      shakemap: [
        {
          status: "UPDATE",
          properties: { maxmmi: "nan", "maxmmi-grid": "5.781", "review-status": "automatic" },
          contents: {
            "download/cont_mmi.json": { url: `${P}/shakemap/us7000twg9/us/1/download/cont_mmi.json` },
          },
        },
      ],
      losspager: [
        {
          status: "UPDATE",
          properties: { alertlevel: "yellow" },
          contents: {
            "json/alerts.json": { url: `${P}/losspager/us7000twg9/us/1/json/alerts.json` },
            "json/exposures.json": { url: "https://evil.example.com/exposures.json" },
          },
        },
      ],
      dyfi: [{ status: "UPDATE", properties: { "num-responses": "39", maxmmi: "4.2" }, contents: {} }],
    },
  },
};

describe("USGS enrichment parsers", () => {
  it("recognises USGS event ids and picks the USGS source", () => {
    expect(isUsgsEventId("us7000twg9")).toBe(true);
    expect(isUsgsEventId("nc75012345")).toBe(true);
    expect(isUsgsEventId("../etc/passwd")).toBe(false);
    expect(isUsgsEventId("x")).toBe(false);
    expect(
      usgsEventIdFrom([
        { dataSourceId: "emsc", externalId: "20261106_0000123" },
        { dataSourceId: "usgs", externalId: "us7000twg9" },
      ]),
    ).toBe("us7000twg9");
    expect(usgsEventIdFrom([{ dataSourceId: "emsc", externalId: "us7000twg9" }])).toBeNull();
  });

  it("only follows product URLs on earthquake.usgs.gov", () => {
    expect(safeUsgsUrl(`${P}/x.json`)).toBe(`${P}/x.json`);
    expect(safeUsgsUrl("https://evil.example.com/x.json")).toBeNull();
    expect(safeUsgsUrl("https://earthquake.usgs.gov.evil.com/x")).toBeNull();
    expect(safeUsgsUrl(`${P}/../../x`)).toBeNull();
  });

  it("extracts ShakeMap, PAGER and DYFI from the event detail", () => {
    const d = parseUsgsDetail(DETAIL, "us7000twg9")!;
    expect(d.id).toBe("us7000twg9");
    expect(d.tsunamiFlag).toBe(false);
    expect(d.shakemap).toMatchObject({ maxMmi: 5.8, status: "automatic", pageUrl: `${d.eventUrl}/shakemap` });
    expect(d.shakemap!.contoursUrl).toContain("cont_mmi.json");
    expect(d.pager).toMatchObject({ level: "yellow", exposuresUrl: null });
    expect(d.pager!.alertsUrl).toContain("alerts.json");
    expect(d.dyfi).toMatchObject({ responses: 39, maxCdi: 4.2 });
  });

  it("returns no products for an event without them", () => {
    const d = parseUsgsDetail({ id: "us1234abcd", properties: { mag: 4.6, tsunami: 1, products: { origin: [{}] } } }, "us1234abcd")!;
    expect(d.shakemap).toBeNull();
    expect(d.pager).toBeNull();
    expect(d.dyfi).toBeNull();
    expect(d.tsunamiFlag).toBe(true);
    expect(parseUsgsDetail(null, "x")).toBeNull();
    expect(hasImpactData(null)).toBe(false);
  });

  it("picks the most likely PAGER fatality and loss ranges", () => {
    const r = parsePagerAlerts({
      fatality: {
        level: "orange",
        bins: [
          { min: "0", max: "1", probability: 0.05 },
          { min: "1", max: "10", probability: 0.2 },
          { min: "100", max: "1000", probability: 0.41 },
          { min: "100000", max: "10000000", probability: 0.01 },
        ],
      },
      economic: { level: "red", bins: [{ min: "1000", max: "10000000", probability: 0.6 }] },
    });
    expect(r.fatalities).toEqual({ level: "orange", likely: { min: 100, max: 1000, probability: 0.41 } });
    expect(r.losses).toEqual({ level: "red", likely: { min: 1000, max: null, probability: 0.6 } });
    expect(formatPagerRange(r.fatalities!.likely!, "people")).toBe("100–1,000");
    expect(formatPagerRange(r.losses!.likely!, "usd_millions")).toBe("$1B+");
    expect(formatPagerRange({ min: 1, max: 10, probability: 1 }, "usd_millions")).toBe("$1M–$10M");
    expect(parsePagerAlerts(null)).toEqual({ fatalities: null, losses: null });
  });

  it("lists non-zero PAGER population exposure, strongest first", () => {
    const rows = parsePagerExposures({
      population_exposure: { mmi: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], aggregated_exposure: [0, 0, 1000, 25000, 4000, 120, 0, 0, 0, 0] },
    });
    expect(rows).toEqual([
      { mmi: 6, population: 120 },
      { mmi: 5, population: 4000 },
      { mmi: 4, population: 25000 },
      { mmi: 3, population: 1000 },
    ]);
    expect(parsePagerExposures({})).toEqual([]);
  });

  it("turns cont_mmi.json into lean labelled line features", () => {
    const fc = parseMmiContours({
      type: "FeatureCollection",
      features: [
        { properties: { value: 3.5, color: "#90f2ff" }, geometry: { type: "MultiLineString", coordinates: [[[143.196398, 35.866667], [143.20489, 35.839687]]] } },
        { properties: { value: 4, color: "javascript:alert(1)" }, geometry: { type: "LineString", coordinates: [[142.1, 34.2], [142.2, 34.3], ["x", 1]] } },
        { properties: { value: 5 }, geometry: { type: "MultiLineString", coordinates: [[[1, 1]]] } }, // too short
        { properties: {}, geometry: { type: "MultiLineString", coordinates: [] } },
      ],
    });
    expect(fc.features).toHaveLength(2);
    expect(fc.features[0].properties).toEqual({ mmi: 3.5, color: "#90f2ff", label: "" });
    expect(fc.features[0].geometry.coordinates[0][0]).toEqual([143.1964, 35.8667]);
    expect(fc.features[1].properties).toEqual({ mmi: 4, color: mmiColor(4), label: "IV" });
    expect(fc.features[1].geometry.coordinates[0]).toHaveLength(2);
    expect(parseMmiContours("nope").features).toEqual([]);
  });

  it("names intensities on the USGS scale", () => {
    expect(mmiRoman(5.78)).toBe("VI");
    expect(mmiRoman(0)).toBe("I");
    expect(mmiShaking(7)).toBe("Very strong");
    expect(mmiShaking(11)).toBe("Extreme");
    expect(mmiColor(6)).toBe("#ffff00");
  });
});

describe("Open-Meteo weather helpers", () => {
  it("validates coordinates", () => {
    expect(parseLatLon("35.6", "139.7")).toEqual({ lat: 35.6, lon: 139.7 });
    expect(parseLatLon("-90", "180")).toEqual({ lat: -90, lon: 180 });
    expect(parseLatLon("91", "0")).toBeNull();
    expect(parseLatLon("0", "-180.1")).toBeNull();
    expect(parseLatLon("abc", "0")).toBeNull();
    expect(parseLatLon(null, "0")).toBeNull();
    expect(parseLatLon("", "")).toBeNull();
    expect(parseLatLon("Infinity", "0")).toBeNull();
  });

  it("snaps coordinates to a 0.05° grid", () => {
    expect(roundCoord(35.6789)).toBe(35.7);
    expect(roundCoord(35.624)).toBe(35.6);
    expect(roundCoord(35.626)).toBe(35.65);
    expect(roundCoord(-0.01)).toBe(0);
    expect(roundCoord(-122.4194)).toBe(-122.4);
    expect(weatherKey(35.626, 139.71)).toBe("35.65,139.70");
    expect(weatherKey(35.63, 139.69, { marine: true, flood: true })).toBe("35.65,139.70,m,f");
  });

  it("maps WMO weather codes", () => {
    expect(weatherCode(0)).toEqual({ label: "Clear sky", icon: "clear" });
    expect(weatherCode(63).icon).toBe("rain");
    expect(weatherCode(75)).toEqual({ label: "Heavy snow", icon: "snow" });
    expect(weatherCode(99).icon).toBe("storm");
    expect(weatherCode(42)).toEqual({ label: "Unknown", icon: "unknown" });
    expect(weatherCode(null).icon).toBe("unknown");
    expect(compass(0)).toBe("N");
    expect(compass(342)).toBe("NNW");
    expect(compass(-90)).toBe("W");
    expect(compass(null)).toBe("");
  });

  it("parses the forecast response and summarises the next 24 h", () => {
    const f = parseForecast({
      latitude: 35.65,
      longitude: 139.6875,
      elevation: 38,
      utc_offset_seconds: 32400,
      timezone: "Asia/Tokyo",
      timezone_abbreviation: "GMT+9",
      current: { time: "2026-11-13T08:15", temperature_2m: 10.3, relative_humidity_2m: 82, apparent_temperature: 9.5, precipitation: 0, weather_code: 0, wind_speed_10m: 1.1, wind_direction_10m: 342, wind_gusts_10m: 9.7, is_day: 1 },
      hourly: {
        time: ["2026-11-13T08:00", "2026-11-13T09:00", "2026-11-13T10:00"],
        temperature_2m: [9.8, 12.1, 14.6],
        precipitation_probability: [0, 40, 10],
        precipitation: [0, 1.25, 0.1],
        weather_code: [0, 61, 3],
        wind_speed_10m: [1, 3, 5],
        wind_gusts_10m: [9, 22.5, 14],
      },
    })!;
    expect(f.now).toMatchObject({ temperatureC: 10.3, code: 0, gustKmh: 9.7, isDay: true });
    expect(f.hours).toHaveLength(3);
    expect(f.next24).toEqual({ minC: 9.8, maxC: 14.6, precipMm: 1.4, maxPrecipProbPct: 40, maxGustKmh: 22.5, worstCode: 61 });
    expect(f.elevationM).toBe(38);
    expect(f.timezone).toBe("GMT+9");
    expect(parseForecast({ error: true, reason: "bad" })).toBeNull();
  });

  it("parses marine data and treats land (nulls) as no sea state", () => {
    expect(
      parseMarine({ current: { wave_height: 1.62, wave_period: 6, wave_direction: 238, swell_wave_height: 0.88, sea_surface_temperature: 23.7 }, hourly: { wave_height: [1.6, 2.1, null] } }),
    ).toEqual({ waveHeightM: 1.62, wavePeriodS: 6, waveDirDeg: 238, swellHeightM: 0.88, seaTempC: 23.7, maxWaveHeight24hM: 2.1 });
    expect(parseMarine({ current: { wave_height: null, wave_period: null } })).toBeNull();
  });

  it("parses river discharge from today onward", () => {
    const raw = {
      daily: {
        time: ["2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14"],
        river_discharge: [9.57, 17.03, 39.55, 32.19],
        river_discharge_median: [12.37, 19.42, 39.55, 32.19],
      },
    };
    expect(parseFlood(raw, "2026-11-12")).toEqual({ todayM3s: 17.03, peakM3s: 39.55, peakDate: "2026-11-13", medianM3s: 19.42 });
    expect(parseFlood({ daily: { time: ["2026-11-12"], river_discharge: [null] } }, "2026-11-12")).toBeNull();
    expect(parseFlood(null, "2026-11-12")).toBeNull();
  });

  it("decides which events get weather", () => {
    expect(wantsWeather({ type: "FLOOD", geoPrecision: "region" })).toBe(true);
    expect(wantsWeather({ type: "FIRE", geoPrecision: "country" })).toBe(false);
    expect(wantsWeather({ type: "NEWS", geoPrecision: "exact" })).toBe(true);
    expect(wantsWeather({ type: "NEWS", geoPrecision: "region" })).toBe(false);
    expect(wantsWeather({ type: "WEATHER", geoPrecision: "exact", isSynthetic: true })).toBe(false);
  });
});

describe("enrichment cache", () => {
  it("caches values, shares in-flight loads and remembers failures briefly", async () => {
    let t = 0;
    const cache = new TtlCache<number>(1000, 2, 100, () => t);
    let calls = 0;
    const load = async () => ++calls;
    const [a, b] = await Promise.all([cache.get("k", load), cache.get("k", load)]);
    expect([a, b, calls]).toEqual([1, 1, 1]);
    t = 999;
    expect(await cache.get("k", load)).toBe(1);
    t = 1000;
    expect(await cache.get("k", load)).toBe(2);

    const fail = async () => {
      calls++;
      throw new UpstreamError("HTTP 429", 502);
    };
    const before = calls;
    await expect(cache.get("bad", fail)).rejects.toThrow("429");
    await expect(cache.get("bad", fail)).rejects.toThrow("429");
    expect(calls - before).toBe(1);
    t += 100;
    await expect(cache.get("bad", fail)).rejects.toThrow();
    expect(calls - before).toBe(2);

    await cache.get("x", load);
    expect(cache.size).toBe(2); // capped
  });
});
