/**
 * Satellite imagery catalogue and pure helpers (shared by server and client).
 *
 * Two kinds of imagery, never to be confused in the UI:
 *  - Mosaics (Blue Marble, Sentinel-2 cloudless 2024, Esri World Imagery, USGS
 *    orthoimagery): sharp, but stitched from captures months or years old.
 *  - Recent imagery from NASA GIBS: geostationary (GOES-East/West, Himawari,
 *    every 10 min, ~0.5–2 km/px) and polar-orbiting daily composites (VIIRS).
 *    Tiles are requested with an explicit time so the map refreshes when a newer
 *    image is published.
 */

export type SatSourceId = "mosaic" | "live" | "daily" | "night";
export type HiresProviderId = "esri" | "usgs" | "off";

export const GIBS_BASE = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best";

export interface GibsLayer {
  /** GIBS layer identifier */
  id: string;
  label: string;
  tileMatrixSet: string;
  /** Native max zoom of the tile matrix set */
  maxzoom: number;
  ext: "png" | "jpg";
  cadence: "10min" | "daily";
  /** Approximate ground resolution, for the UI */
  resolution: string;
}

export const GIBS_LAYERS = {
  goesEast: {
    id: "GOES-East_ABI_GeoColor",
    label: "GOES-East GeoColor",
    tileMatrixSet: "GoogleMapsCompatible_Level7",
    maxzoom: 7,
    ext: "png",
    cadence: "10min",
    resolution: "~1–2 km",
  },
  goesWest: {
    id: "GOES-West_ABI_GeoColor",
    label: "GOES-West GeoColor",
    tileMatrixSet: "GoogleMapsCompatible_Level7",
    maxzoom: 7,
    ext: "png",
    cadence: "10min",
    resolution: "~1–2 km",
  },
  himawariVis: {
    id: "Himawari_AHI_Band3_Red_Visible_1km",
    label: "Himawari red visible",
    tileMatrixSet: "GoogleMapsCompatible_Level7",
    maxzoom: 7,
    ext: "png",
    cadence: "10min",
    resolution: "~0.5–1 km",
  },
  himawariIr: {
    id: "Himawari_AHI_Band13_Clean_Infrared",
    label: "Himawari infrared",
    tileMatrixSet: "GoogleMapsCompatible_Level6",
    maxzoom: 6,
    ext: "png",
    cadence: "10min",
    resolution: "~2 km",
  },
  goesEastIr: {
    id: "GOES-East_ABI_Band13_Clean_Infrared",
    label: "GOES-East infrared",
    tileMatrixSet: "GoogleMapsCompatible_Level6",
    maxzoom: 6,
    ext: "png",
    cadence: "10min",
    resolution: "~2 km",
  },
  goesWestIr: {
    id: "GOES-West_ABI_Band13_Clean_Infrared",
    label: "GOES-West infrared",
    tileMatrixSet: "GoogleMapsCompatible_Level6",
    maxzoom: 6,
    ext: "png",
    cadence: "10min",
    resolution: "~2 km",
  },
  viirs: {
    id: "VIIRS_NOAA20_CorrectedReflectance_TrueColor",
    label: "VIIRS NOAA-20 true colour",
    tileMatrixSet: "GoogleMapsCompatible_Level9",
    maxzoom: 9,
    ext: "jpg",
    cadence: "daily",
    resolution: "~250–375 m",
  },
  dnb: {
    id: "VIIRS_SNPP_DayNightBand_At_Sensor_Radiance",
    label: "VIIRS Suomi NPP night band",
    tileMatrixSet: "GoogleMapsCompatible_Level8",
    maxzoom: 8,
    ext: "png",
    cadence: "daily",
    resolution: "~750 m",
  },
} as const satisfies Record<string, GibsLayer>;

export type GibsKey = keyof typeof GIBS_LAYERS;
export const GIBS_KEYS = Object.keys(GIBS_LAYERS) as GibsKey[];

/** Latest published time per layer: ISO timestamp (10-min layers) or YYYY-MM-DD (daily). */
export type ImageryTimes = Partial<Record<GibsKey, string>>;

export interface ImageryLatestResponse {
  times: ImageryTimes;
  checkedAt: string;
  /** "describe-domains" (fresh) or "capabilities" (fallback, CDN-cached up to 30 min) */
  via: string;
  failed: GibsKey[];
}

export function gibsTileUrl(layer: GibsLayer, time: string): string {
  return `${GIBS_BASE}/${layer.id}/default/${time}/${layer.tileMatrixSet}/{z}/{y}/{x}.${layer.ext}`;
}

/** Normalise a GIBS time ("2026-10-07T17:50:00Z" or "2026-10-07") or return null. */
export function normaliseTime(t: string, cadence: GibsLayer["cadence"]): string | null {
  const s = t.trim();
  if (cadence === "daily") {
    const m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
    return m ? m[1] : null;
  }
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?Z?$/.exec(s);
  if (!m) return null;
  return `${m[1]}T${m[2]}:${m[3]}:${m[4] ?? "00"}Z`;
}

/**
 * Latest time in a WMTS time domain: a comma- or element-separated list of
 * "start/end/period" intervals or single instants. Returns the greatest end.
 */
export function latestInDomain(values: string[], cadence: GibsLayer["cadence"]): string | null {
  let best: string | null = null;
  for (const v of values.flatMap((x) => x.split(","))) {
    const parts = v.trim().split("/");
    if (!parts[0]) continue;
    const end = parts.length >= 2 ? parts[1] : parts[0];
    const t = normaliseTime(end, cadence);
    if (t && (!best || t > best)) best = t;
  }
  return best;
}

/** Parse a GIBS DescribeDomains response for the time dimension's latest value. */
export function parseDescribeDomains(xml: string, cadence: GibsLayer["cadence"]): string | null {
  const dim = /<DimensionDomain>[\s\S]*?<\/DimensionDomain>/i.exec(xml);
  if (!dim || !/<ows:Identifier>\s*time\s*<\/ows:Identifier>/i.test(dim[0])) return null;
  const domain = /<Domain>([\s\S]*?)<\/Domain>/i.exec(dim[0]);
  return domain ? latestInDomain([domain[1]], cadence) : null;
}

/**
 * Parse the full WMTS capabilities document for the given layers' latest times
 * (max of the time Dimension's <Default> and its last <Value> interval end).
 */
export function parseCapabilitiesTimes(xml: string, keys: GibsKey[] = GIBS_KEYS): ImageryTimes {
  const byId = new Map<string, GibsKey>(keys.map((k) => [GIBS_LAYERS[k].id, k]));
  const out: ImageryTimes = {};
  for (const block of xml.split(/<Layer>/).slice(1)) {
    const id = /<ows:Identifier>([^<]+)<\/ows:Identifier>/.exec(block)?.[1]?.trim();
    const key = id ? byId.get(id) : undefined;
    if (!key) continue;
    const dim = /<Dimension>([\s\S]*?)<\/Dimension>/.exec(block)?.[1];
    if (!dim) continue;
    const cadence = GIBS_LAYERS[key].cadence;
    const values = [...dim.matchAll(/<Value>([^<]+)<\/Value>/g)].map((m) => m[1]);
    const def = /<Default>([^<]+)<\/Default>/.exec(dim)?.[1];
    const candidates = [latestInDomain(values, cadence), def ? normaliseTime(def, cadence) : null].filter((x): x is string => !!x);
    if (candidates.length) out[key] = candidates.sort().at(-1)!;
  }
  return out;
}

const DAY = 86_400_000;

/**
 * `t` and the `n` earlier 10-minute steps, newest first. GIBS sometimes lists a
 * time a few minutes before its tiles are published, so the server walks back
 * until a tile actually exists.
 */
export function candidateTimes(t: string, n = 3): string[] {
  const ms = Date.parse(t);
  if (!Number.isFinite(ms)) return [];
  return Array.from({ length: n + 1 }, (_, i) => new Date(ms - i * 600_000).toISOString().replace(".000Z", "Z"));
}

/**
 * Daily composites are built pass by pass, so "today" is only partly imaged
 * (missing areas are black). Use the most recent day that has fully finished in UTC.
 */
export function completeDay(latest: string, now: Date): string {
  const today = now.toISOString().slice(0, 10);
  if (latest < today) return latest;
  return new Date(Date.parse(`${today}T00:00:00Z`) - DAY).toISOString().slice(0, 10);
}

/** Himawari's visible band is black at night; use infrared outside local daytime at the sub-satellite point (140.7° E). */
export function himawariDaylight(at: Date): boolean {
  const localHour = (at.getUTCHours() + at.getUTCMinutes() / 60 + 140.7 / 15 + 24) % 24;
  return localHour >= 7.5 && localHour <= 16.5;
}

/** Geostationary satellites by sub-satellite longitude (useful disk ≈ ±70° of longitude). */
export const GEO_SATS = [
  { key: "goesEast" as const, lon: -75.2 },
  { key: "goesWest" as const, lon: -137.2 },
  { key: "himawari" as const, lon: 140.7 },
];
export type GeoSat = (typeof GEO_SATS)[number]["key"];

function lonDiff(a: number, b: number) {
  const d = Math.abs((((a - b) % 360) + 540) % 360 - 180);
  return d;
}

/** The geostationary satellite that best sees a longitude, or null (Europe/Africa/W Asia: no keyless layer). */
export function geoSatelliteFor(lon: number): GeoSat | null {
  let best: { key: GeoSat; d: number } | null = null;
  for (const s of GEO_SATS) {
    const d = lonDiff(lon, s.lon);
    if (d <= 70 && (!best || d < best.d)) best = { key: s.key, d };
  }
  return best?.key ?? null;
}

// ---- zoom ramps --------------------------------------------------------------

/** Sentinel-2 cloudless fades in over Blue Marble. */
export const S2_FADE: [number, number] = [4, 5];
/** Very-high-resolution imagery (Esri / USGS) fades in over Sentinel-2. */
export const HIRES_FADE: [number, number] = [10.5, 11.5];
/** Recent-imagery layers fade out to the mosaic beyond their useful resolution. */
export const RECENT_FADE: Record<Exclude<SatSourceId, "mosaic">, [number, number]> = {
  live: [7.5, 9],
  daily: [9.5, 11],
  night: [8.5, 10],
};

export const HIRES_MAXZOOM: Record<HiresProviderId, number> = { esri: 19, usgs: 18, off: 16 };

/** Map max zoom for a basemap: deep zoom only where imagery supports it. */
export function maxZoomFor(mapStyle: "dark" | "satellite" | "night", hires: HiresProviderId): number {
  return mapStyle === "satellite" ? HIRES_MAXZOOM[hires] : 14;
}

/** Linear 0→1 ramp of `zoom` between a and b. */
export function ramp(zoom: number, [a, b]: [number, number]): number {
  return Math.min(1, Math.max(0, (zoom - a) / (b - a)));
}

export interface ImageryDescription {
  /** Human name of the dominant imagery at this view */
  name: string;
  resolution: string;
  /** True only for imagery published within the last hours (geostationary) */
  live: boolean;
  /** Image time (ISO or date) when known */
  time: string | null;
  note: string;
}

const MOSAIC_NOTE = "Mosaic of past captures — not live";

/** Which mosaic tier dominates at a zoom level. */
export function mosaicAt(zoom: number, hires: HiresProviderId): ImageryDescription {
  if (zoom < (S2_FADE[0] + S2_FADE[1]) / 2)
    return { name: "NASA Blue Marble", resolution: "~500 m", live: false, time: null, note: "Cloud-free composite (2004) — not live" };
  if (hires === "off" || zoom < (HIRES_FADE[0] + HIRES_FADE[1]) / 2)
    return { name: "Sentinel-2 cloudless 2024", resolution: "10 m", live: false, time: null, note: `${MOSAIC_NOTE} (2024)` };
  if (hires === "usgs")
    return { name: "USGS National Map orthoimagery", resolution: "~1 m (US only)", live: false, time: null, note: `${MOSAIC_NOTE} (aerial, various years; US only)` };
  return { name: "Esri World Imagery", resolution: "0.3–1 m in many places", live: false, time: null, note: `${MOSAIC_NOTE} (various dates)` };
}

/** Describe what the satellite view is showing at this zoom/centre, honestly. */
export function describeImagery(
  source: SatSourceId,
  zoom: number,
  lon: number,
  hires: HiresProviderId,
  times: ImageryTimes,
  now: Date,
): ImageryDescription {
  if (source !== "mosaic" && zoom >= (RECENT_FADE[source][0] + RECENT_FADE[source][1]) / 2) return mosaicAt(zoom, hires);
  if (source === "live") {
    const sat = geoSatelliteFor(lon);
    if (!sat) {
      return { ...mosaicAt(zoom, hires), note: "No keyless geostationary imagery over Europe, Africa or western Asia — showing the mosaic (not live)" };
    }
    if (sat === "himawari") {
      const vis = himawariDaylight(now);
      const l = vis ? GIBS_LAYERS.himawariVis : GIBS_LAYERS.himawariIr;
      return { name: l.label, resolution: l.resolution, live: true, time: times[vis ? "himawariVis" : "himawariIr"] ?? null, note: "Geostationary, new image every 10 min" };
    }
    const l = GIBS_LAYERS[sat];
    return { name: l.label, resolution: l.resolution, live: true, time: times[sat] ?? null, note: "Geostationary, new image every 10 min" };
  }
  if (source === "daily") {
    const t = times.viirs ? completeDay(times.viirs, now) : null;
    return { name: GIBS_LAYERS.viirs.label, resolution: GIBS_LAYERS.viirs.resolution, live: false, time: t, note: "Daily composite of polar-orbit passes (most recent complete UTC day)" };
  }
  if (source === "night") {
    const t = times.dnb ? completeDay(times.dnb, now) : null;
    return { name: GIBS_LAYERS.dnb.label, resolution: GIBS_LAYERS.dnb.resolution, live: false, time: t, note: "Nightly passes, one image per day (lights, moonlit clouds)" };
  }
  return mosaicAt(zoom, hires);
}

/** "17:50 UTC (12 min ago)" or "6 Oct 2026" for daily images. */
export function formatImageTime(time: string | null, now: Date): string | null {
  if (!time) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(time)) {
    return new Date(`${time}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  }
  const t = Date.parse(time);
  if (!Number.isFinite(t)) return null;
  const mins = Math.max(0, Math.round((now.getTime() - t) / 60_000));
  const ago = mins < 60 ? `${mins} min ago` : `${Math.floor(mins / 60)} h ${mins % 60} min ago`;
  return `${time.slice(11, 16)} UTC (${ago})`;
}

// ---- dynamic raster layers -------------------------------------------------

export interface DynamicRaster {
  /** Stable slot (one layer per slot; replaced when its time changes) */
  slot: string;
  layer: GibsLayer;
  time: string;
  opacity: number | ["interpolate", ["linear"], ["zoom"], ...number[]];
  /** Where it goes: "base" (inside the satellite basemap) or "overlay" (above any basemap) */
  group: "base" | "overlay";
}

function fadeOut([a, b]: [number, number], max = 1): DynamicRaster["opacity"] {
  return ["interpolate", ["linear"], ["zoom"], a, max, b, 0];
}

/**
 * The GIBS layers to draw for the current settings, bottom to top. Pure: the
 * globe reconciles these with the map (adding a new source when a time changes).
 */
export function desiredRasters(
  opts: { mapStyle: "dark" | "satellite" | "night"; satSource: SatSourceId; clouds: boolean },
  times: ImageryTimes,
  now: Date,
): DynamicRaster[] {
  const out: DynamicRaster[] = [];
  const add = (slot: string, key: GibsKey, group: DynamicRaster["group"], opacity: DynamicRaster["opacity"], time?: string | null) => {
    const t = time ?? times[key];
    if (t) out.push({ slot, layer: GIBS_LAYERS[key], time: t, opacity, group });
  };
  if (opts.mapStyle === "satellite") {
    if (opts.satSource === "live") {
      const fade = fadeOut(RECENT_FADE.live);
      add("geo-himawari", himawariDaylight(now) ? "himawariVis" : "himawariIr", "base", fade);
      add("geo-west", "goesWest", "base", fade);
      add("geo-east", "goesEast", "base", fade);
    } else if (opts.satSource === "daily" && times.viirs) {
      add("daily-viirs", "viirs", "base", fadeOut(RECENT_FADE.daily), completeDay(times.viirs, now));
    } else if (opts.satSource === "night" && times.dnb) {
      add("night-dnb", "dnb", "base", fadeOut(RECENT_FADE.night), completeDay(times.dnb, now));
    }
  }
  if (opts.clouds) {
    // Infrared is opaque grey (cold cloud tops white), so draw it semi-transparent.
    const fade = fadeOut([7, 9], 0.5);
    add("ir-himawari", "himawariIr", "overlay", fade);
    add("ir-west", "goesWestIr", "overlay", fade);
    add("ir-east", "goesEastIr", "overlay", fade);
  }
  return out;
}

export function rasterId(r: DynamicRaster): string {
  return `gibs-${r.slot}-${r.time.replace(/[^0-9]/g, "")}`;
}
