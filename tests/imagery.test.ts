import { describe, expect, it } from "vitest";
import {
  GIBS_LAYERS,
  candidateTimes,
  completeDay,
  describeImagery,
  desiredRasters,
  formatImageTime,
  geoSatelliteFor,
  gibsTileUrl,
  himawariDaylight,
  latestInDomain,
  maxZoomFor,
  mosaicAt,
  normaliseTime,
  parseCapabilitiesTimes,
  parseDescribeDomains,
  ramp,
  rasterId,
  rasterSlot,
  HIRES_FADE,
  type ImageryTimes,
} from "@/lib/imagery";
import { basemapVisibility, buildStyle, labelLayers } from "@/components/globe/style";

// Shape of a GIBS WMTS DescribeDomains response (Oct 2026).
const DOMAINS_GOES = `<?xml version="1.0"?><Domains xmlns:ows='http://www.opengis.net/ows/1.1'><SpaceDomain><BoundingBox maxy='20037508.342789' maxx='20037508.342789' miny='-20037508.342789' minx='-20037508.342789' crs='urn:ogc:def:crs:EPSG::3857'/></SpaceDomain><DimensionDomain><ows:Identifier>time</ows:Identifier><Domain>2026-10-05/2026-10-07T17:50:00Z/PT10M</Domain><Size>1</Size></DimensionDomain></Domains>`;
const DOMAINS_HIMAWARI = `<Domains xmlns:ows='http://www.opengis.net/ows/1.1'><DimensionDomain><ows:Identifier>time</ows:Identifier><Domain>2026-10-05/2026-10-05T02:30:00Z/PT10M,2026-10-05T02:50:00Z/2026-10-07T14:30:00Z/PT10M,2026-10-07T14:50:00Z/2026-10-07T18:10:00Z/PT10M</Domain><Size>3</Size></DimensionDomain></Domains>`;
const DOMAINS_DAILY = `<Domains xmlns:ows='http://www.opengis.net/ows/1.1'><DimensionDomain><ows:Identifier>time</ows:Identifier><Domain>2026-10-05/2026-10-07/P1D</Domain><Size>1</Size></DimensionDomain></Domains>`;

// Trimmed WMTS capabilities: one sub-daily layer, one daily layer, one unrelated layer.
const CAPS = `<Capabilities><Contents>
<Layer><ows:Title>GOES-East GeoColor</ows:Title><ows:Identifier>GOES-East_ABI_GeoColor</ows:Identifier>
<Dimension><ows:Identifier>Time</ows:Identifier><ows:UOM>ISO8601</ows:UOM><Default>2026-10-07T17:10:00Z</Default><Current>false</Current>
<Value>2026-08-10T16:30:00Z/2026-08-10T16:30:00Z/PT10M</Value><Value>2026-09-30T02:40:00Z/2026-10-07T17:10:00Z/PT10M</Value></Dimension>
<TileMatrixSetLink><TileMatrixSet>GoogleMapsCompatible_Level7</TileMatrixSet></TileMatrixSetLink></Layer>
<Layer><ows:Identifier>VIIRS_NOAA20_CorrectedReflectance_TrueColor</ows:Identifier>
<Dimension><ows:Identifier>Time</ows:Identifier><Default>2026-10-07</Default><Value>2018-01-05/2018-02-21/P1D</Value><Value>2022-01-14/2026-10-07/P1D</Value></Dimension></Layer>
<Layer><ows:Identifier>Something_Else</ows:Identifier><Dimension><Default>2030-01-01</Default></Dimension></Layer>
</Contents></Capabilities>`;

describe("GIBS time parsing", () => {
  it("normalises instants and dates", () => {
    expect(normaliseTime("2026-10-07T17:50:00Z", "10min")).toBe("2026-10-07T17:50:00Z");
    expect(normaliseTime("2026-10-07T17:50Z", "10min")).toBe("2026-10-07T17:50:00Z");
    expect(normaliseTime("2026-10-07", "10min")).toBeNull();
    expect(normaliseTime("2026-10-07T00:00:00Z", "daily")).toBe("2026-10-07");
    expect(normaliseTime("garbage", "daily")).toBeNull();
  });

  it("finds the latest interval end in a domain", () => {
    expect(latestInDomain(["2026-10-01/2026-10-03/P1D", "2026-10-05/2026-10-07/P1D"], "daily")).toBe("2026-10-07");
    expect(latestInDomain(["2026-10-07T10:00:00Z/2026-10-07T12:00:00Z/PT10M,2026-10-07T09:00:00Z"], "10min")).toBe("2026-10-07T12:00:00Z");
    expect(latestInDomain(["2026-10-07T10:00:00Z"], "10min")).toBe("2026-10-07T10:00:00Z");
    expect(latestInDomain([], "10min")).toBeNull();
  });

  it("parses DescribeDomains responses", () => {
    expect(parseDescribeDomains(DOMAINS_GOES, "10min")).toBe("2026-10-07T17:50:00Z");
    expect(parseDescribeDomains(DOMAINS_HIMAWARI, "10min")).toBe("2026-10-07T18:10:00Z");
    expect(parseDescribeDomains(DOMAINS_DAILY, "daily")).toBe("2026-10-07");
    expect(parseDescribeDomains("<ExceptionReport/>", "daily")).toBeNull();
  });

  it("parses capabilities for the requested layers only", () => {
    const t = parseCapabilitiesTimes(CAPS);
    expect(t.goesEast).toBe("2026-10-07T17:10:00Z");
    expect(t.viirs).toBe("2026-10-07");
    expect(Object.keys(t).sort()).toEqual(["goesEast", "viirs"]);
    expect(parseCapabilitiesTimes(CAPS, ["viirs"])).toEqual({ viirs: "2026-10-07" });
  });

  it("walks back 10-minute steps for unpublished frames", () => {
    expect(candidateTimes("2026-10-07T18:00:00Z", 2)).toEqual(["2026-10-07T18:00:00Z", "2026-10-07T17:50:00Z", "2026-10-07T17:40:00Z"]);
    expect(candidateTimes("2026-10-07T00:00:00Z", 1)[1]).toBe("2026-10-06T23:50:00Z");
    expect(candidateTimes("nope")).toEqual([]);
  });

  it("uses the last complete UTC day for daily composites", () => {
    const now = new Date("2026-10-07T18:40:00Z");
    expect(completeDay("2026-10-07", now)).toBe("2026-10-06");
    expect(completeDay("2026-10-05", now)).toBe("2026-10-05");
    expect(completeDay("2026-10-08", now)).toBe("2026-10-06");
  });

  it("builds explicit-time tile URLs", () => {
    expect(gibsTileUrl(GIBS_LAYERS.goesEast, "2026-10-07T17:50:00Z")).toBe(
      "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/GOES-East_ABI_GeoColor/default/2026-10-07T17:50:00Z/GoogleMapsCompatible_Level7/{z}/{y}/{x}.png",
    );
    expect(gibsTileUrl(GIBS_LAYERS.viirs, "2026-10-06")).toContain("/VIIRS_NOAA20_CorrectedReflectance_TrueColor/default/2026-10-06/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg");
  });

  it("formats image times honestly", () => {
    const now = new Date("2026-10-07T18:40:00Z");
    expect(formatImageTime("2026-10-07T18:10:00Z", now)).toBe("18:10 UTC (30 min ago)");
    expect(formatImageTime("2026-10-07T16:10:00Z", now)).toBe("16:10 UTC (2 h 30 min ago)");
    expect(formatImageTime("2026-10-06", now)).toBe("6 Oct 2026");
    expect(formatImageTime(null, now)).toBeNull();
  });
});

describe("geostationary coverage", () => {
  it("picks the satellite that sees a longitude", () => {
    expect(geoSatelliteFor(-77)).toBe("goesEast"); // Washington
    expect(geoSatelliteFor(-122)).toBe("goesWest"); // San Francisco
    expect(geoSatelliteFor(-157)).toBe("goesWest"); // Hawaii
    expect(geoSatelliteFor(139.7)).toBe("himawari"); // Tokyo
    expect(geoSatelliteFor(-178)).toBe("goesWest");
    expect(geoSatelliteFor(178)).toBe("himawari");
    expect(geoSatelliteFor(2.3)).toBeNull(); // Paris
    expect(geoSatelliteFor(37)).toBeNull(); // Nairobi
  });

  it("uses Himawari visible only in local daytime", () => {
    expect(himawariDaylight(new Date("2026-10-07T03:00:00Z"))).toBe(true); // ~12:20 local
    expect(himawariDaylight(new Date("2026-10-07T15:00:00Z"))).toBe(false); // ~00:20 local
  });
});

describe("zoom → imagery", () => {
  it("ramps and max zoom", () => {
    expect(ramp(10, HIRES_FADE)).toBe(0);
    expect(ramp(11, HIRES_FADE)).toBeCloseTo(0.5);
    expect(ramp(13, HIRES_FADE)).toBe(1);
    expect(maxZoomFor("satellite", "esri")).toBe(19);
    expect(maxZoomFor("satellite", "usgs")).toBe(18);
    expect(maxZoomFor("satellite", "off")).toBe(17);
    expect(maxZoomFor("dark", "esri")).toBe(17);
    expect(maxZoomFor("night", "esri")).toBe(17);
  });

  it("names the dominant mosaic tier and never calls it live", () => {
    expect(mosaicAt(2, "esri").name).toBe("NASA Blue Marble");
    expect(mosaicAt(8, "esri").name).toBe("Sentinel-2 cloudless 2024");
    expect(mosaicAt(15, "esri").name).toBe("Esri World Imagery");
    expect(mosaicAt(15, "usgs").name).toContain("USGS");
    expect(mosaicAt(15, "off").name).toBe("Sentinel-2 cloudless 2024");
    for (const z of [1, 6, 12, 18]) expect(mosaicAt(z, "esri").live).toBe(false);
  });

  const times: ImageryTimes = {
    goesEast: "2026-10-07T17:50:00Z",
    goesWest: "2026-10-07T17:40:00Z",
    himawariVis: "2026-10-07T18:00:00Z",
    himawariIr: "2026-10-07T18:00:00Z",
    goesEastIr: "2026-10-07T18:00:00Z",
    goesWestIr: "2026-10-07T18:00:00Z",
    viirs: "2026-10-07",
    dnb: "2026-10-07",
  };
  const now = new Date("2026-10-07T18:40:00Z");

  it("describes live geostationary imagery with its time, and the mosaic beyond its resolution", () => {
    const d = describeImagery("live", 3, -80, "esri", times, now);
    expect(d).toMatchObject({ name: "GOES-East GeoColor", live: true, time: "2026-10-07T17:50:00Z" });
    expect(describeImagery("live", 3, 140, "esri", times, now).name).toBe("Himawari infrared"); // night in Japan
    const europe = describeImagery("live", 3, 10, "esri", times, now);
    expect(europe.live).toBe(false);
    expect(europe.note).toMatch(/Europe/);
    const deep = describeImagery("live", 14, -80, "esri", times, now);
    expect(deep).toMatchObject({ name: "Esri World Imagery", live: false });
  });

  it("describes daily imagery with the last complete day, not as live", () => {
    expect(describeImagery("daily", 5, 0, "esri", times, now)).toMatchObject({ live: false, time: "2026-10-06" });
    expect(describeImagery("night", 5, 0, "esri", times, now)).toMatchObject({ live: false, time: "2026-10-06" });
  });

  it("selects GIBS rasters per mode", () => {
    const live = desiredRasters({ mapStyle: "satellite", satSource: "live", clouds: false }, times, now);
    expect(live.map((r) => r.slot)).toEqual(["geo-himawari", "geo-west", "geo-east"]);
    expect(live[0].layer.id).toBe("Himawari_AHI_Band13_Clean_Infrared");
    expect(live.every((r) => r.group === "base")).toBe(true);
    const day = desiredRasters({ mapStyle: "satellite", satSource: "live", clouds: false }, times, new Date("2026-10-07T03:00:00Z"));
    expect(day[0].layer.id).toBe("Himawari_AHI_Band3_Red_Visible_1km");

    const daily = desiredRasters({ mapStyle: "satellite", satSource: "daily", clouds: false }, times, now);
    expect(daily).toHaveLength(1);
    expect(daily[0].time).toBe("2026-10-06");

    expect(desiredRasters({ mapStyle: "satellite", satSource: "mosaic", clouds: false }, times, now)).toEqual([]);
    // Satellite sources only apply to the satellite basemap; clouds apply everywhere.
    expect(desiredRasters({ mapStyle: "dark", satSource: "live", clouds: false }, times, now)).toEqual([]);
    const clouds = desiredRasters({ mapStyle: "dark", satSource: "live", clouds: true }, times, now);
    expect(clouds.map((r) => r.group)).toEqual(["overlay", "overlay", "overlay"]);
    // Missing times → nothing requested (no guessing).
    expect(desiredRasters({ mapStyle: "satellite", satSource: "live", clouds: true }, {}, now)).toEqual([]);
  });

  it("gives each frame and band its own layer id within a stable slot", () => {
    const [a] = desiredRasters({ mapStyle: "satellite", satSource: "daily", clouds: false }, times, now);
    const [b] = desiredRasters({ mapStyle: "satellite", satSource: "daily", clouds: false }, { ...times, viirs: "2026-10-08" }, new Date("2026-10-08T12:00:00Z"));
    expect(rasterId(a)).not.toBe(rasterId(b));
    expect(rasterSlot(rasterId(a))).toBe("gibs-daily-viirs");
    expect(rasterSlot(rasterId(b))).toBe("gibs-daily-viirs");
    const night = desiredRasters({ mapStyle: "satellite", satSource: "live", clouds: false }, times, now)[0];
    const dayFrame = desiredRasters({ mapStyle: "satellite", satSource: "live", clouds: false }, times, new Date("2026-10-07T03:00:00Z"))[0];
    expect(rasterId(night)).not.toBe(rasterId(dayFrame));
    expect(rasterSlot(rasterId(night))).toBe("gibs-geo-himawari");
  });
});

describe("basemap style", () => {
  it("shows the chosen very-high-res provider and hybrid layers only on satellite", () => {
    const sat = basemapVisibility("satellite", { hires: "esri", hybrid: true });
    expect(sat["raster-esri"]).toBe("visible");
    expect(sat["raster-usgs"]).toBe("none");
    expect(sat["hy-roads-major"]).toBe("visible");
    expect(sat["raster-s2"]).toBe("visible");
    const off = basemapVisibility("satellite", { hires: "off", hybrid: false });
    expect(off["raster-esri"]).toBe("none");
    expect(off["hy-road-labels"]).toBe("none");
    const dark = basemapVisibility("dark", { hires: "esri", hybrid: true });
    expect(dark["raster-esri"]).toBe("none");
    expect(dark["hy-roads-major"]).toBe("none");
    expect(dark["water"]).toBe("visible");
  });

  it("credits every imagery source and keeps the marker layer", () => {
    const style = buildStyle("satellite");
    const src = style.sources as Record<string, { attribution?: string; maxzoom?: number }>;
    expect(src.esri.attribution).toMatch(/Esri, Vantor, Earthstar Geographics, and the GIS User Community/);
    expect(src.esri.maxzoom).toBe(19);
    expect(src.usgs.attribution).toMatch(/USGS/);
    expect(src.s2cloudless.attribution).toMatch(/Sentinel-2/);
    const ids = style.layers.map((l) => l.id);
    expect(ids.indexOf("raster-s2")).toBeLessThan(ids.indexOf("raster-esri"));
    expect(ids.indexOf("raster-esri")).toBeLessThan(ids.indexOf("imagery-top"));
    expect(ids.indexOf("imagery-top")).toBeLessThan(ids.indexOf("boundary-state"));
    expect(labelLayers().map((l) => l.id)).toContain("hy-road-labels");
  });
});
