/**
 * "Drop in" street-level view: pure helpers (camera targets, formatting and
 * parsing of the keyless photo APIs). No DOM or map access here, so it is unit-tested.
 */

/** Camera for the street-level view. */
export const DROP_ZOOM = 16.5;
export const DROP_PITCH = 72;
export const DROP_DURATION_MS = 2500;
export const EXIT_DURATION_MS = 2000;
/** Pitch limits: the globe normally stops at 60°, the drop-in view allows lower horizons. */
export const GLOBE_MAX_PITCH = 60;
export const DROP_MAX_PITCH = 85;
/** Orbit speed (degrees of bearing per second). */
export const ORBIT_DEG_PER_S = 4;

export const PHOTO_USER_AGENT = "WorldView/0.1 (https://github.com/akshng/worldview; drop-in photos)";

export interface CameraView {
  center: [number, number];
  zoom: number;
  bearing: number;
  pitch: number;
}

/** flyTo target for dropping in at a point, keeping the current heading. */
export function dropInCamera(target: { lon: number; lat: number }, currentBearing: number): CameraView {
  return {
    center: [clampLon(target.lon), clampLat(target.lat)],
    zoom: DROP_ZOOM,
    bearing: normalizeBearing(currentBearing),
    pitch: DROP_PITCH,
  };
}

export const clampLat = (lat: number) => Math.max(-85, Math.min(85, lat));
export const clampLon = (lon: number) => ((((lon + 180) % 360) + 360) % 360) - 180;

/** Bearing in [-180, 180). */
export function normalizeBearing(b: number): number {
  const n = ((((b + 180) % 360) + 360) % 360) - 180;
  return Object.is(n, -0) ? 0 : n;
}

/** Bearing after `dtMs` of orbiting. */
export function orbitStep(bearing: number, dtMs: number, degPerS = ORBIT_DEG_PER_S): number {
  // Long gaps (tab was in the background, a frame stalled) must not jump the view.
  const dt = Math.min(Math.max(dtMs, 0), 100);
  return normalizeBearing(bearing + (degPerS * dt) / 1000);
}

/** "40.7580° N, 73.9855° W" */
export function formatCoords(lat: number, lon: number, digits = 4): string {
  const ns = lat >= 0 ? "N" : "S";
  const ew = lon >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(digits)}° ${ns}, ${Math.abs(lon).toFixed(digits)}° ${ew}`;
}

/** Terrain heights from MapLibre include the exaggeration; undo it and round. */
export function formatElevation(raw: number | null | undefined, exaggeration: number): string | null {
  if (raw === null || raw === undefined || !Number.isFinite(raw) || exaggeration <= 0) return null;
  const m = Math.round(raw / exaggeration);
  return `${m.toLocaleString("en-US")} m`;
}

/** Decode an AWS/Mapzen terrarium pixel to metres. */
export const terrariumElevation = (r: number, g: number, b: number) => r * 256 + g + b / 256 - 32768;

// ---------------------------------------------------------------------------
// Photos: Wikimedia Commons geosearch (+ Panoramax street-level pictures)
// ---------------------------------------------------------------------------

export interface NearbyPhoto {
  id: string;
  source: "commons" | "panoramax";
  title: string;
  thumb: string;
  /** Page to open (Commons file page / Panoramax viewer) */
  href: string;
  /** Author / licence line shown under the thumbnail */
  credit: string;
  lat: number;
  lon: number;
  distanceM: number | null;
  /** Capture date (Panoramax) */
  date?: string;
}

/** One request: geosearch generator + imageinfo thumbnails + author/licence metadata. */
export function commonsGeosearchUrl(lat: number, lon: number, radiusM = 1000, limit = 24): string {
  const p = new URLSearchParams({
    action: "query",
    format: "json",
    formatversion: "2",
    origin: "*",
    generator: "geosearch",
    ggscoord: `${lat.toFixed(5)}|${lon.toFixed(5)}`,
    ggsradius: String(Math.min(10_000, Math.max(10, Math.round(radiusM)))),
    ggsnamespace: "6",
    ggslimit: String(limit),
    prop: "imageinfo|coordinates",
    iiprop: "url|extmetadata",
    iiurlwidth: "320",
    iiextmetadatafilter: "Artist|LicenseShortName|ObjectName",
  });
  return `https://commons.wikimedia.org/w/api.php?${p.toString()}`;
}

/** Strip HTML tags / entities from Commons extmetadata values (Artist is often a link). */
export function plainText(html: string | undefined | null): string {
  if (!html) return "";
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

interface CommonsPage {
  pageid?: number;
  title?: string;
  coordinates?: Array<{ lat: number; lon: number }>;
  imageinfo?: Array<{
    thumburl?: string;
    descriptionurl?: string;
    extmetadata?: Record<string, { value?: string } | undefined>;
  }>;
}

export function parseCommons(body: unknown, origin: { lat: number; lon: number }): NearbyPhoto[] {
  const pages = (body as { query?: { pages?: CommonsPage[] } } | null)?.query?.pages;
  if (!Array.isArray(pages)) return [];
  const out: NearbyPhoto[] = [];
  for (const p of pages) {
    const info = p.imageinfo?.[0];
    const c = p.coordinates?.[0];
    if (!info?.thumburl || !p.title || !c) continue;
    // Only still images make sense as thumbnails (skip PDFs, audio, video stills are fine as jpg thumbs).
    if (!/\.(jpe?g|png|webp|tiff?|gif)$/i.test(p.title)) continue;
    const meta = info.extmetadata ?? {};
    const artist = plainText(meta.Artist?.value).slice(0, 80);
    const licence = plainText(meta.LicenseShortName?.value);
    const name = plainText(meta.ObjectName?.value) || p.title.replace(/^File:/, "").replace(/\.[a-z]+$/i, "");
    out.push({
      id: `commons:${p.pageid ?? p.title}`,
      source: "commons",
      title: name,
      thumb: info.thumburl,
      href: info.descriptionurl ?? `https://commons.wikimedia.org/wiki/${encodeURIComponent(p.title.replace(/ /g, "_"))}`,
      credit: [artist || "Unknown author", licence, "Wikimedia Commons"].filter(Boolean).join(" · "),
      lat: c.lat,
      lon: c.lon,
      distanceM: Math.round(distanceM(origin.lat, origin.lon, c.lat, c.lon)),
    });
  }
  return out.sort((a, b) => (a.distanceM ?? 0) - (b.distanceM ?? 0));
}

/** Panoramax (open street-level imagery federation) STAC search around a point. */
export function panoramaxSearchUrl(lat: number, lon: number, radiusM = 300, limit = 8): string {
  const dLat = radiusM / 111_320;
  const dLon = radiusM / (111_320 * Math.max(0.05, Math.cos((lat * Math.PI) / 180)));
  const bbox = [lon - dLon, lat - dLat, lon + dLon, lat + dLat].map((v) => v.toFixed(5)).join(",");
  return `https://api.panoramax.xyz/api/search?bbox=${bbox}&limit=${limit}`;
}

interface PanoramaxFeature {
  id?: string;
  geometry?: { type?: string; coordinates?: [number, number] };
  assets?: Record<string, { href?: string } | undefined>;
  properties?: Record<string, unknown>;
  providers?: Array<{ name?: string; roles?: string[] }>;
}

export function parsePanoramax(body: unknown, origin: { lat: number; lon: number }): NearbyPhoto[] {
  const feats = (body as { features?: PanoramaxFeature[] } | null)?.features;
  if (!Array.isArray(feats)) return [];
  const out: NearbyPhoto[] = [];
  for (const f of feats) {
    const thumb = f.assets?.thumb?.href;
    const coords = f.geometry?.coordinates;
    if (!f.id || !thumb || !Array.isArray(coords)) continue;
    const [lon, lat] = coords;
    const props = f.properties ?? {};
    const producer = typeof props["geovisio:producer"] === "string" ? (props["geovisio:producer"] as string) : f.providers?.find((p) => p.roles?.includes("producer"))?.name;
    const licence = typeof props.license === "string" ? (props.license as string) : null;
    const date = typeof props.datetime === "string" ? (props.datetime as string).slice(0, 10) : undefined;
    out.push({
      id: `panoramax:${f.id}`,
      source: "panoramax",
      title: date ? `Street-level photo, ${date}` : "Street-level photo",
      thumb,
      href: `https://api.panoramax.xyz/#focus=pic&pic=${encodeURIComponent(f.id)}`,
      credit: [producer ?? "Unknown author", licence, "Panoramax"].filter(Boolean).join(" · "),
      lat,
      lon,
      distanceM: Math.round(distanceM(origin.lat, origin.lon, lat, lon)),
      date,
    });
  }
  return out.sort((a, b) => (a.distanceM ?? 0) - (b.distanceM ?? 0));
}

export function distanceM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function formatDistance(m: number | null): string {
  if (m === null) return "";
  return m < 1000 ? `${m} m` : `${(m / 1000).toFixed(1)} km`;
}

/** Place classes from the OpenMapTiles "place" layer, most local first. */
const LOCAL_PLACE_RANK: Record<string, number> = {
  neighbourhood: 0,
  quarter: 0,
  suburb: 1,
  hamlet: 1,
  isolated_dwelling: 1,
  village: 2,
  town: 3,
  city: 4,
};

/**
 * Pick the most local named place near the drop point from vector-tile features
 * (neighbourhood beats suburb beats town…, among those within `maxKm`).
 */
export function nearestLocalPlace(
  places: Array<{ name: string | null | undefined; cls: string | null | undefined; lat: number; lon: number }>,
  at: { lat: number; lon: number },
  maxKm = 3,
): string | null {
  let best: { name: string; score: number } | null = null;
  for (const p of places) {
    if (!p.name || !p.cls || !(p.cls in LOCAL_PLACE_RANK)) continue;
    const km = distanceM(at.lat, at.lon, p.lat, p.lon) / 1000;
    const limit = p.cls === "city" || p.cls === "town" ? maxKm * 4 : maxKm;
    if (km > limit) continue;
    const score = LOCAL_PLACE_RANK[p.cls] * 2 + km;
    if (!best || score < best.score) best = { name: p.name, score };
  }
  return best?.name ?? null;
}
