/**
 * Public cameras from official open-data feeds (keyless). Only cameras that their
 * operators publish for public viewing — traffic and road-weather cameras.
 * The browser loads each image/stream directly from the operator.
 *
 * Row: [id, name, lon, lat, sourceIndex, imageUrl, videoUrl | null, videoKind | null]
 * imageUrl is "" for video-only cameras (operators that publish live streams but no stills);
 * every row has a still, a video, or both. videoKind "hls" means a live stream.
 */
import type { LayerContext, LayerSnapshot, LiveLayerProvider } from "../types";

export type CameraRow = [string, string, number, number, number, string, string | null, "mp4" | "hls" | null];

/** True when the camera has a live (HLS) stream rather than only stills or a recorded clip. */
export const isLiveVideo = (r: CameraRow) => r[7] === "hls" && !!r[6];

export interface CameraSource {
  id: string;
  name: string;
  region: string;
  homepage: string;
  license: string;
  /** How often the operator updates still images, seconds */
  refreshSec: number;
}

export interface CamerasData {
  sources: CameraSource[];
  rows: CameraRow[];
  /** How many rows have a live (HLS) stream */
  liveCount: number;
  failed: string[];
}

export const CAMERA_SOURCES: CameraSource[] = [
  { id: "tfl", name: "Transport for London JamCams", region: "London, UK", homepage: "https://tfl.gov.uk/traffic/status/", license: "TfL open data (Open Government Licence)", refreshSec: 300 },
  { id: "nyc", name: "NYC DOT traffic cameras", region: "New York City, US", homepage: "https://webcams.nyctmc.org/", license: "NYC DOT public cameras", refreshSec: 2 },
  { id: "caltrans", name: "Caltrans CCTV", region: "California, US", homepage: "https://cwwp2.dot.ca.gov/", license: "California Department of Transportation public data", refreshSec: 60 },
  { id: "hk", name: "Hong Kong Transport Department", region: "Hong Kong", homepage: "https://data.gov.hk/en-data/dataset/hk-td-tis_2-traffic-snapshot-images", license: "DATA.GOV.HK terms", refreshSec: 120 },
  { id: "fi", name: "Fintraffic road weather cameras", region: "Finland", homepage: "https://www.digitraffic.fi/en/road-traffic/", license: "Fintraffic / digitraffic.fi, CC BY 4.0", refreshSec: 600 },
  { id: "sg", name: "Singapore LTA traffic cameras", region: "Singapore", homepage: "https://data.gov.sg/", license: "Singapore Open Data Licence", refreshSec: 60 },
  { id: "dgt", name: "DGT traffic cameras", region: "Spain", homepage: "https://nap.dgt.es/", license: "DGT National Access Point open data, reuse with attribution (Ley 37/2007)", refreshSec: 180 },
  { id: "il", name: "Illinois DOT Gateway cameras", region: "Illinois and neighbouring states, US", homepage: "https://www.travelmidwest.com/", license: "Illinois DOT Gateway Traveler Information, CC BY-SA 2.0", refreshSec: 300 },
  { id: "wsdot", name: "WSDOT highway cameras", region: "Washington State, US", homepage: "https://wsdot.com/travel/real-time/map/", license: "WSDOT Travel Information Cameras public data (low-volume use, no warranty)", refreshSec: 300 },
  { id: "ia", name: "Iowa DOT traffic cameras", region: "Iowa, US", homepage: "https://data.iowadot.gov/maps/traffic-cameras-3", license: "Iowa DOT open data, CC BY 4.0", refreshSec: 120 },
  { id: "bc", name: "DriveBC highway cameras", region: "British Columbia, Canada", homepage: "https://www.drivebc.ca/", license: "Open Government Licence – British Columbia", refreshSec: 300 },
  { id: "is", name: "Vegagerðin road cameras", region: "Iceland", homepage: "https://www.vegagerdin.is/", license: "Vegagerðin open data (free reuse, no conditions)", refreshSec: 600 },
  { id: "to", name: "City of Toronto traffic cameras", region: "Toronto, Canada", homepage: "https://open.toronto.ca/dataset/traffic-cameras/", license: "City of Toronto Open Data portal terms", refreshSec: 120 },
  { id: "cgy", name: "City of Calgary traffic cameras", region: "Calgary, Canada", homepage: "https://data.calgary.ca/Transportation-Transit/Traffic-Cameras/k7p9-kppz", license: "Open Government Licence – City of Calgary", refreshSec: 120 },
  { id: "ky", name: "KYTC traffic cameras", region: "Kentucky, US", homepage: "https://maps.kytc.ky.gov/trafficcameras/", license: "Kentucky Transportation Cabinet public camera layer (no warranty)", refreshSec: 120 },
  { id: "qld", name: "QLDTraffic webcams", region: "Queensland, Australia", homepage: "https://www.data.qld.gov.au/dataset/qldtraffic-geojson-api", license: "Queensland Department of Transport and Main Roads, CC BY 4.0", refreshSec: 60 },
  { id: "atx", name: "City of Austin traffic cameras", region: "Austin, Texas, US", homepage: "https://data.austintexas.gov/Transportation-and-Mobility/Traffic-Cameras/b4k4-adkb", license: "City of Austin open data, Public Domain", refreshSec: 300 },
  { id: "sd", name: "SD511 road cameras", region: "South Dakota, US", homepage: "https://www.sd511.org/", license: "South Dakota DOT SD511 public camera feed (no warranty)", refreshSec: 300 },
  { id: "va", name: "VDOT 511 Virginia cameras", region: "Virginia, US", homepage: "https://511.vdot.virginia.gov/", license: "Virginia DOT 511 public camera feed (real-time viewing only, not recorded)", refreshSec: 120 },
  { id: "sc", name: "SCDOT SC511 cameras", region: "South Carolina, US", homepage: "https://www.511sc.org/", license: "South Carolina DOT SC511 public camera feed (no warranty)", refreshSec: 120 },
  { id: "md", name: "Maryland CHART cameras", region: "Maryland, US", homepage: "https://chart.maryland.gov/", license: "Maryland SHA CHART public data feed", refreshSec: 60 },
  { id: "de", name: "DelDOT traffic cameras", region: "Delaware, US", homepage: "https://deldot.gov/map/", license: "Delaware DOT TMC public camera feed", refreshSec: 60 },
  { id: "mo", name: "MoDOT Traveler cameras", region: "Missouri, US", homepage: "https://traveler.modot.org/map/", license: "Missouri DOT Traveler Information public feed (incl. Ozarks Traffic, Springfield)", refreshSec: 60 },
  { id: "co", name: "COtrip cameras", region: "Colorado, US", homepage: "https://www.cotrip.org/", license: "Colorado DOT COtrip public camera feed", refreshSec: 120 },
  { id: "in", name: "INDOT TrafficWise cameras", region: "Indiana, US", homepage: "https://511in.org/", license: "Indiana DOT 511IN public camera feed", refreshSec: 120 },
  { id: "al", name: "ALGO Traffic cameras", region: "Alabama, US", homepage: "https://algotraffic.com/", license: "Alabama DOT ALGO Traffic public camera feed", refreshSec: 60 },
  { id: "ok", name: "OKTraffic cameras", region: "Oklahoma, US", homepage: "https://oktraffic.org/", license: "Oklahoma DOT OKTraffic public camera feed", refreshSec: 60 },
  { id: "ks", name: "KanDrive cameras", region: "Kansas, US", homepage: "https://www.kandrive.gov/", license: "Kansas DOT KanDrive public camera feed (no warranty)", refreshSec: 300 },
  { id: "ne", name: "Nebraska 511 cameras", region: "Nebraska, US", homepage: "https://511.nebraska.gov/", license: "Nebraska DOT 511 public camera feed (no warranty)", refreshSec: 300 },
];
const IDX = Object.fromEntries(CAMERA_SOURCES.map((s, i) => [s.id, i]));

const ok = (lat: number, lon: number) => Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0);
const https = (u: unknown) => (typeof u === "string" && /^https:\/\//.test(u) ? u : null);

async function getJson(url: string, ctx: LayerContext, headers: Record<string, string> = {}) {
  const res = await fetch(url, { signal: ctx.signal, headers: { "User-Agent": ctx.userAgent, Accept: "application/json", ...headers }, cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function getText(url: string, ctx: LayerContext) {
  const res = await fetch(url, { signal: ctx.signal, headers: { "User-Agent": ctx.userAgent }, cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

export function tflRows(list: Array<{ id: string; commonName: string; lat: number; lon: number; additionalProperties?: Array<{ key: string; value: string }> }>): CameraRow[] {
  const rows: CameraRow[] = [];
  for (const c of list ?? []) {
    const prop = (k: string) => c.additionalProperties?.find((p) => p.key === k)?.value;
    const img = https(prop("imageUrl"));
    if (prop("available") !== "true" || !img || !ok(c.lat, c.lon)) continue;
    const vid = https(prop("videoUrl"));
    rows.push([`tfl:${c.id}`, c.commonName, c.lon, c.lat, IDX.tfl, img, vid, vid ? "mp4" : null]);
  }
  return rows;
}

export function nycRows(list: Array<{ id: string; name: string; latitude: number; longitude: number; isOnline?: string; imageUrl?: string }>): CameraRow[] {
  return (list ?? [])
    .filter((c) => c.isOnline === "true" && https(c.imageUrl) && ok(c.latitude, c.longitude))
    .map((c) => [`nyc:${c.id}`, c.name, c.longitude, c.latitude, IDX.nyc, c.imageUrl!, null, null]);
}

type CaltransItem = { cctv: { index: string; inService: string; location: { district: string; locationName: string; latitude: string; longitude: string }; imageData: { streamingVideoURL?: string; static?: { currentImageURL?: string } } } };
export function caltransRows(list: CaltransItem[]): CameraRow[] {
  const rows: CameraRow[] = [];
  for (const { cctv: c } of list ?? []) {
    const lat = Number(c.location.latitude), lon = Number(c.location.longitude);
    const img = https(c.imageData?.static?.currentImageURL);
    if (c.inService !== "true" || !img || !ok(lat, lon)) continue;
    // A few District 8 entries are published as "http://" or "ttps://" — the same server serves them over https.
    const vid = hlsUrl((c.imageData?.streamingVideoURL ?? "").trim().replace(/^(?:https?|ttps):\/\/wzmedia\.dot\.ca\.gov\//, "https://wzmedia.dot.ca.gov/"));
    rows.push([`caltrans:${c.location.district}:${c.index}`, c.location.locationName.replace(/^\S+\s+--\s+/, ""), lon, lat, IDX.caltrans, img, vid, vid ? "hls" : null]);
  }
  return rows;
}

/** HK publishes a UTF-16 tab-separated file. */
export function hkRows(tsv: string): CameraRow[] {
  const lines = tsv.replace(/^﻿/, "").split(/\r?\n/);
  const head = lines[0].split("\t").map((h) => h.replace(/^﻿/, "").trim());
  const col = (n: string) => head.indexOf(n);
  const rows: CameraRow[] = [];
  for (const line of lines.slice(1)) {
    const f = line.split("\t");
    const lat = Number(f[col("latitude")]), lon = Number(f[col("longitude")]);
    const img = https(f[col("url")]?.trim());
    if (!img || !ok(lat, lon)) continue;
    rows.push([`hk:${f[col("key")]}`, (f[col("description")] ?? "").replace(/\s*\[[^\]]+\]\s*$/, "").trim(), lon, lat, IDX.hk, img, null, null]);
  }
  return rows;
}

export function fiRows(fc: { features?: Array<{ id: string; geometry: { coordinates: number[] }; properties: { name: string; collectionStatus?: string; presets?: Array<{ id: string; inCollection?: boolean }> } }> }): CameraRow[] {
  const rows: CameraRow[] = [];
  for (const f of fc.features ?? []) {
    const [lon, lat] = f.geometry?.coordinates ?? [];
    const preset = f.properties.presets?.find((p) => p.inCollection !== false);
    if (f.properties.collectionStatus !== "GATHERING" || !preset || !ok(lat, lon)) continue;
    const name = f.properties.name.replace(/^[a-z]+\d+_/i, "").replace(/_/g, " ");
    rows.push([`fi:${preset.id}`, name, lon, lat, IDX.fi, `https://weathercam.digitraffic.fi/${preset.id}.jpg`, null, null]);
  }
  return rows;
}

export function sgRows(j: { items?: Array<{ cameras?: Array<{ camera_id: string; image: string; location: { latitude: number; longitude: number } }> }> }): CameraRow[] {
  return (j.items?.[0]?.cameras ?? [])
    .filter((c) => https(c.image) && ok(c.location.latitude, c.location.longitude))
    .map((c) => [`sg:${c.camera_id}`, `Traffic camera ${c.camera_id}`, c.location.longitude, c.location.latitude, IDX.sg, c.image, null, null]);
}

/** "SAN SEBASTIÁN" → "San Sebastián" (leaves mixed-case text alone). */
const titleCase = (s: string) => (s === s.toUpperCase() ? s.toLowerCase().replace(/(^|[\s(/-])(\p{L})/gu, (_, a: string, b: string) => a + b.toUpperCase()) : s);
/** Number from a feed value; blank or missing is NaN (not 0), so it fails the coordinate check. */
const num = (v: unknown) => (v === null || v === undefined || (typeof v === "string" && !v.trim()) ? NaN : Number(v));
const fileId = (url: string) => decodeURIComponent(url.split("?")[0].split("/").pop() ?? "").replace(/\.[a-z]+$/i, "");

/** Spain DGT DATEX II v3 DevicePublication (XML; parsed with patterns so no XML dependency is needed). */
export function dgtRows(xml: string): CameraRow[] {
  const rows: CameraRow[] = [];
  const tag = (body: string, name: string) => new RegExp(`<(?:\\w+:)?${name}>([^<]*)</`).exec(body)?.[1]?.trim();
  for (const m of xml.matchAll(/<(?:\w+:)?device\b[^>]*?\bid="([^"]+)"[^>]*>([\s\S]*?)<\/(?:\w+:)?device>/g)) {
    const [, id, body] = m;
    if (tag(body, "typeOfDevice") !== "camera") continue;
    const lat = num(tag(body, "latitude")), lon = num(tag(body, "longitude"));
    const img = https(tag(body, "deviceUrl")?.replace(/&amp;/g, "&"));
    if (!img || !ok(lat, lon)) continue;
    const road = tag(body, "roadName") ?? "";
    const km = tag(body, "kilometerPoint");
    const place = titleCase(tag(body, "province") ?? "");
    const name = [road && km ? `${road} km ${km}` : road, place].filter(Boolean).join(", ") || `Camera ${id}`;
    rows.push([`dgt:${id}`, name, lon, lat, IDX.dgt, img, null, null]);
  }
  return rows;
}

type GeoPoint = { type: string; coordinates: number[] | number[][] };
type GeoFeature<P> = { id?: string | number; geometry: GeoPoint | null; properties: P };
/** First [lon, lat] of a Point or MultiPoint. */
const lonLat = (g: GeoPoint | null | undefined): [number, number] => {
  const c = g?.coordinates;
  const p = (Array.isArray(c?.[0]) ? c[0] : c) as number[] | undefined;
  return [num(p?.[0]), num(p?.[1])];
};

/** Illinois DOT Gateway layer (GeoJSON from ArcGIS). Skips snapshots the operator flags as more than 30 min old. */
export function ilRows(fc: { features?: Array<GeoFeature<{ ImgPath?: string; CameraLocation?: string; CameraDirection?: string; SnapShot?: string; TooOld?: string }>> }): CameraRow[] {
  const rows: CameraRow[] = [];
  const seen = new Set<string>();
  for (const f of fc.features ?? []) {
    const p = f.properties;
    const [lon, lat] = lonLat(f.geometry);
    const img = https(p.SnapShot);
    if (p.TooOld === "true" || !img || !ok(lat, lon)) continue;
    const q = new URLSearchParams((p.ImgPath ?? "").split("?")[1] ?? "");
    const dir = p.CameraDirection && p.CameraDirection !== "NONE" ? p.CameraDirection : "";
    const id = `il:${q.get("id") ?? fileId(img)}${dir ? `:${dir}` : ""}`;
    if (seen.has(id)) continue;
    seen.add(id);
    rows.push([id, `${p.CameraLocation ?? "Camera"}${dir ? ` (${dir})` : ""}`, lon, lat, IDX.il, img, null, null]);
  }
  return rows;
}

const WSDOT_HOSTS = /(^|\.)(wsdot\.wa\.gov|tripcheck\.com)$/;
/** WSDOT cameras layer. Keeps only frames hosted by WSDOT itself or ODOT TripCheck (the layer also lists a few third-party webcams). */
export function wsdotRows(fc: { features?: Array<GeoFeature<{ OBJECTID?: number; CameraTitle?: string; ImageURL?: string }>> }): CameraRow[] {
  const rows: CameraRow[] = [];
  for (const f of fc.features ?? []) {
    const p = f.properties;
    const [lon, lat] = lonLat(f.geometry);
    const img = https(p.ImageURL);
    if (!img || !ok(lat, lon) || !WSDOT_HOSTS.test(new URL(img).hostname)) continue;
    rows.push([`wsdot:${p.OBJECTID ?? f.id}`, (p.CameraTitle ?? "").trim() || "WSDOT camera", lon, lat, IDX.wsdot, img, null, null]);
  }
  return rows;
}

/** Iowa DOT traffic cameras (GeoJSON from ArcGIS); many have an HLS live stream. */
export function iaRows(fc: { features?: Array<GeoFeature<{ Desc_?: string; ImageName?: string; ImageURL?: string; VideoURL?: string | null }>> }): CameraRow[] {
  const rows: CameraRow[] = [];
  const seen = new Set<string>();
  for (const f of fc.features ?? []) {
    const p = f.properties;
    const [lon, lat] = lonLat(f.geometry);
    const img = https(p.ImageURL);
    if (!img || !ok(lat, lon)) continue;
    const id = `ia:${fileId(img).toLowerCase()}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const vid = https(p.VideoURL);
    const hls = vid && /\.m3u8(\?|$)/.test(vid) ? vid : null;
    rows.push([id, (p.Desc_ || p.ImageName || "Iowa DOT camera").trim(), lon, lat, IDX.ia, img, hls, hls ? "hls" : null]);
  }
  return rows;
}

/** DriveBC webcams: only cameras that are on, shown on DriveBC and not marked stale. */
export function bcRows(list: Array<{ id: number; name: string; is_on?: boolean; should_appear?: boolean; marked_stale?: boolean; location?: GeoPoint }>): CameraRow[] {
  const rows: CameraRow[] = [];
  for (const c of list ?? []) {
    const [lon, lat] = lonLat(c.location);
    if (!c.is_on || c.should_appear === false || c.marked_stale || !Number.isInteger(c.id) || !ok(lat, lon)) continue;
    rows.push([`bc:${c.id}`, c.name, lon, lat, IDX.bc, `https://www.drivebc.ca/images/${c.id}.jpg`, null, null]);
  }
  return rows;
}

/** Vegagerðin (Iceland) webcam list: one entry per camera view. */
export function isRows(list: Array<{ Myndavel?: string; Skyring?: string; Slod?: string; Breidd?: number; Lengd?: number }>): CameraRow[] {
  const rows: CameraRow[] = [];
  const seen = new Set<string>();
  for (const c of list ?? []) {
    const img = https(c.Slod);
    const lat = num(c.Breidd), lon = num(c.Lengd);
    if (!img || !ok(lat, lon) || seen.has(img)) continue;
    seen.add(img);
    rows.push([`is:${fileId(img)}`, (c.Skyring || c.Myndavel || "Road camera").trim(), lon, lat, IDX.is, img, null, null]);
  }
  return rows;
}

/** City of Toronto traffic camera list (GeoJSON, MultiPoint). */
export function toRows(fc: { features?: Array<GeoFeature<{ REC_ID?: number; IMAGEURL?: string; MAINROAD?: string; CROSSROAD?: string }>> }): CameraRow[] {
  const rows: CameraRow[] = [];
  for (const f of fc.features ?? []) {
    const p = f.properties;
    const [lon, lat] = lonLat(f.geometry);
    const img = https(p.IMAGEURL);
    if (!img || !ok(lat, lon)) continue;
    const name = [p.MAINROAD, p.CROSSROAD].filter(Boolean).map((s) => titleCase(s!.trim())).join(" & ") || `Camera ${p.REC_ID}`;
    rows.push([`to:${p.REC_ID ?? fileId(img)}`, name, lon, lat, IDX.to, img, null, null]);
  }
  return rows;
}

/** City of Calgary open data (Socrata). The feed lists http links; the same images are served over https by trafficcam.calgary.ca. */
export function cgyRows(list: Array<{ camera_url?: { url?: string }; camera_location?: string; point?: GeoPoint }>): CameraRow[] {
  const rows: CameraRow[] = [];
  for (const c of list ?? []) {
    const raw = c.camera_url?.url ?? "";
    const img = https(raw.replace(/^http:\/\/trafficcam\.calgary\.ca\//, "https://trafficcam.calgary.ca/"));
    const [lon, lat] = lonLat(c.point);
    if (!img || !ok(lat, lon)) continue;
    rows.push([`cgy:${fileId(img)}`, c.camera_location?.trim() || "Calgary traffic camera", lon, lat, IDX.cgy, img, null, null]);
  }
  return rows;
}

/** Kentucky Transportation Cabinet camera layer (GeoJSON from ArcGIS); https snapshots only. */
export function kyRows(fc: { features?: Array<GeoFeature<{ description?: string | null; name?: string | null; snapshot?: string | null }>> }): CameraRow[] {
  const rows: CameraRow[] = [];
  const seen = new Set<string>();
  for (const f of fc.features ?? []) {
    const p = f.properties;
    const [lon, lat] = lonLat(f.geometry);
    const img = https(p.snapshot);
    if (!img || !ok(lat, lon) || seen.has(img)) continue;
    seen.add(img);
    rows.push([`ky:${fileId(img)}`, (p.description || p.name || "Kentucky traffic camera").trim(), lon, lat, IDX.ky, img, null, null]);
  }
  return rows;
}

/** QLDTraffic webcams (GeoJSON, keyless open-data feed). */
export function qldRows(fc: { features?: Array<GeoFeature<{ id?: number; description?: string; image_url?: string }>> }): CameraRow[] {
  const rows: CameraRow[] = [];
  for (const f of fc.features ?? []) {
    const p = f.properties;
    const [lon, lat] = lonLat(f.geometry);
    const img = https(p.image_url);
    if (!img || !ok(lat, lon)) continue;
    rows.push([`qld:${p.id ?? fileId(img)}`, (p.description ?? "").trim() || "QLDTraffic webcam", lon, lat, IDX.qld, img, null, null]);
  }
  return rows;
}

/** City of Austin camera inventory (Socrata): only cameras the city lists as turned on. */
export function atxRows(list: Array<{ camera_id?: string; location_name?: string; camera_status?: string; screenshot_address?: string; location?: GeoPoint }>): CameraRow[] {
  const rows: CameraRow[] = [];
  for (const c of list ?? []) {
    const img = https(c.screenshot_address);
    const [lon, lat] = lonLat(c.location);
    if (c.camera_status !== "TURNED_ON" || !img || !ok(lat, lon)) continue;
    rows.push([`atx:${c.camera_id ?? fileId(img)}`, titleCase((c.location_name ?? "").trim()).replace(/\s+\/\s+/g, " / ") || "Austin traffic camera", lon, lat, IDX.atx, img, null, null]);
  }
  return rows;
}

/** SD511 camera sites: each site lists several views (directions, road surface). */
export function sdRows(fc: { features?: Array<GeoFeature<{ name?: string; route?: string; cameras?: Array<{ id?: string; name?: string; image?: string }> }>> }): CameraRow[] {
  const rows: CameraRow[] = [];
  const seen = new Set<string>();
  for (const f of fc.features ?? []) {
    const p = f.properties;
    const [lon, lat] = lonLat(f.geometry);
    if (!ok(lat, lon)) continue;
    const site = [p.route, p.name].filter(Boolean).join(" ").trim() || "SD511 camera";
    for (const c of p.cameras ?? []) {
      const img = https(c.image);
      if (!img || seen.has(img)) continue;
      seen.add(img);
      const m = /camera_images\/([^/]+)\/([^/]+)\//.exec(img);
      rows.push([`sd:${m ? `${m[1]}:${m[2]}` : fileId(img)}`, c.name ? `${site}: ${c.name.trim()}` : site, lon, lat, IDX.sd, img, null, null]);
    }
  }
  return rows;
}

/** An https HLS playlist URL, else null. Rejects URLs carrying a short-lived `token` (they expire long before the 6 h cache). */
const hlsUrl = (u: unknown) => {
  const v = https(typeof u === "string" ? u.trim() : u);
  return v && /\.m3u8(\?|$)/i.test(v) && !/[?&]token=/i.test(v) ? v : null;
};

/**
 * Iteris / Skyline 511 camera features (VDOT 511 Virginia, SC511): each has an HLS stream and a
 * thumbnail. Cameras the operator flags inactive or as a problem stream are skipped.
 */
export function skylineRows(
  features: Array<GeoFeature<{ id?: string; name?: string; description?: string; route?: string; direction?: string; https_url?: string; image_url?: string; active?: boolean; problem_stream?: boolean }>> | undefined,
  src: "va" | "sc",
): CameraRow[] {
  const rows: CameraRow[] = [];
  const seen = new Set<string>();
  for (const f of features ?? []) {
    const p = f.properties ?? {};
    const [lon, lat] = lonLat(f.geometry);
    const vid = hlsUrl(p.https_url);
    const img = https(p.image_url) ?? "";
    if (p.active === false || p.problem_stream === true || (!vid && !img) || !ok(lat, lon)) continue;
    const id = `${src}:${p.id ?? p.name ?? fileId(vid ?? img)}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const name = (p.description ?? "").trim() || [p.route, p.direction].filter(Boolean).join(" ") || "Traffic camera";
    rows.push([id, name, lon, lat, IDX[src], img, vid, vid ? "hls" : null]);
  }
  return rows;
}

const MD_STREAMER = /^strmr\d+\.sha\.maryland\.gov$/;
/**
 * Maryland CHART camera list. Video only: CHART publishes no stills. The stream URL follows the
 * operator's own player (chart.maryland.gov/Video/GetVideo/{id}): https://{cctvIp}/rtplive/{id}/playlist.m3u8.
 * Cameras offline or in communication failure are skipped.
 */
export function mdRows(list: Array<{ id?: string; name?: string; description?: string; lat?: number; lon?: number; cctvIp?: string; commMode?: string; opStatus?: string }>): CameraRow[] {
  const rows: CameraRow[] = [];
  for (const c of list ?? []) {
    const lat = num(c.lat), lon = num(c.lon);
    if (c.commMode !== "ONLINE" || c.opStatus === "COMM_FAILURE" || !c.id || !/^[0-9a-f]+$/i.test(c.id) || !MD_STREAMER.test(c.cctvIp ?? "") || !ok(lat, lon)) continue;
    const vid = `https://${c.cctvIp}/rtplive/${c.id}/playlist.m3u8`;
    rows.push([`md:${c.id}`, (c.description || c.name || "CHART camera").trim(), lon, lat, IDX.md, "", vid, "hls"]);
  }
  return rows;
}

/** DelDOT video cameras (tmc.deldot.gov). Video only; only enabled cameras with status "Active". */
export function deRows(j: { videoCameras?: Array<{ id?: string; title?: string; lat?: number; lon?: number; enabled?: boolean; status?: string; urls?: { m3u8s?: string } }> }): CameraRow[] {
  const rows: CameraRow[] = [];
  for (const c of j?.videoCameras ?? []) {
    const lat = num(c.lat), lon = num(c.lon);
    const vid = hlsUrl(c.urls?.m3u8s);
    if (!c.enabled || c.status !== "Active" || !vid || !c.id || !ok(lat, lon)) continue;
    rows.push([`de:${c.id}`, titleCase((c.title ?? "").trim()) || `DelDOT ${c.id}`, lon, lat, IDX.de, "", vid, "hls"]);
  }
  return rows;
}

const MO_HOSTS = /(^|\.)(modot\.mo\.gov|ozarkstrafficoneview\.com)$/;
/**
 * MoDOT Traveler streaming cameras. Video only. Keeps streams on MoDOT's own servers and Ozarks
 * Traffic (MoDOT / City of Springfield); KC Scout streams behind traveler.modot.org/tisvc refuse
 * direct playback (HTTP 403) and are skipped.
 */
export function moRows(list: Array<{ location?: string; x?: number; y?: number; html?: string | null }>): CameraRow[] {
  const rows: CameraRow[] = [];
  const seen = new Set<string>();
  for (const c of list ?? []) {
    const lat = num(c.y), lon = num(c.x);
    let vid = hlsUrl(c.html);
    if (!vid || !ok(lat, lon)) continue;
    const u = new URL(vid);
    u.hostname = u.hostname.toLowerCase();
    if (!MO_HOSTS.test(u.hostname)) continue;
    vid = u.toString();
    const stream = /\/rtplive\/([^/]+)\//.exec(u.pathname)?.[1] ?? fileId(vid);
    const id = `mo:${u.hostname.includes("ozarks") ? "oz:" : ""}${stream}`;
    if (seen.has(id)) continue;
    seen.add(id);
    rows.push([id, (c.location ?? "").trim() || "MoDOT camera", lon, lat, IDX.mo, "", vid, "hls"]);
  }
  return rows;
}

type CarsCamera = {
  id?: number | string;
  public?: boolean;
  active?: boolean;
  name?: string;
  location?: { latitude?: number; longitude?: number };
  views?: Array<{ name?: string; type?: string; url?: string; videoPreviewUrl?: string }>;
};
/**
 * Castle Rock CARS 511 camera list (COtrip, 511IN, KanDrive, Nebraska 511): one row per view.
 * "WMP" views are HLS streams with a preview still; "STILL_IMAGE" views are stills. Streams that
 * need a short-lived token are kept as stills only; other view types (e.g. MJPEG relays) are skipped.
 */
export function carsRows(list: CarsCamera[], src: "co" | "in" | "ks" | "ne"): CameraRow[] {
  const rows: CameraRow[] = [];
  const seen = new Set<string>();
  for (const c of list ?? []) {
    const lat = num(c.location?.latitude), lon = num(c.location?.longitude);
    if (c.public === false || c.active === false || !ok(lat, lon)) continue;
    const site = (c.name ?? "").trim() || "Traffic camera";
    const views = c.views ?? [];
    views.forEach((v, i) => {
      let vid: string | null = null, img: string | null = null;
      if (v.type === "WMP") {
        vid = hlsUrl(v.url);
        img = https(v.videoPreviewUrl);
      } else if (v.type === "STILL_IMAGE") img = https(v.url);
      const key = vid ?? img;
      if (!key || seen.has(key)) return;
      seen.add(key);
      const vn = (v.name ?? "").trim();
      const name = views.length > 1 && vn && vn !== site ? `${site}: ${vn}` : site;
      rows.push([`${src}:${c.id}:${i}`, name, lon, lat, IDX[src], img ?? "", vid, vid ? "hls" : null]);
    });
  }
  return rows;
}

/** ALGO Traffic (Alabama DOT) cameras: public cameras with an HLS stream and a snapshot. */
export function alRows(list: Array<{ id?: number; accessLevel?: string; location?: { latitude?: number; longitude?: number; city?: string; displayRouteDesignator?: string; displayCrossStreet?: string; direction?: string }; playbackUrls?: { hls?: string }; snapshotImageUrl?: string }>): CameraRow[] {
  const rows: CameraRow[] = [];
  for (const c of list ?? []) {
    const l = c.location ?? {};
    const lat = num(l.latitude), lon = num(l.longitude);
    const vid = hlsUrl(c.playbackUrls?.hls);
    const img = https(c.snapshotImageUrl) ?? "";
    if (c.accessLevel !== "Public" || (!vid && !img) || c.id === undefined || !ok(lat, lon)) continue;
    const road = [l.displayRouteDesignator, l.displayCrossStreet].filter(Boolean).join(" at ");
    const name = [road, l.city].filter(Boolean).join(", ") || `ALGO camera ${c.id}`;
    rows.push([`al:${c.id}`, name, lon, lat, IDX.al, img, vid, vid ? "hls" : null]);
  }
  return rows;
}

/** OKTraffic (Oklahoma DOT) camera poles → cameras. Video only; skips cameras out of service or blocked from public view. */
export function okRows(poles: Array<{ mapCameras?: Array<{ id?: number; location?: string; latitude?: string | number; longitude?: string | number; status?: string; blockAtis?: string; streamDictionary?: { streamSrc?: string } | null }> }>): CameraRow[] {
  const rows: CameraRow[] = [];
  const seen = new Set<string>();
  for (const p of poles ?? []) {
    for (const m of p.mapCameras ?? []) {
      const lat = num(m.latitude), lon = num(m.longitude);
      const vid = hlsUrl(m.streamDictionary?.streamSrc);
      if (m.status === "Out Of Service" || m.blockAtis === "1" || !vid || m.id === undefined || seen.has(vid) || !ok(lat, lon)) continue;
      seen.add(vid);
      rows.push([`ok:${m.id}`, (m.location ?? "").trim() || "OKTraffic camera", lon, lat, IDX.ok, "", vid, "hls"]);
    }
  }
  return rows;
}

/** All features of an ArcGIS layer as WGS84 GeoJSON, following the server's page size. */
async function arcgisFeatures<T>(layerUrl: string, outFields: string, ctx: LayerContext, orderBy = "OBJECTID", maxPages = 10): Promise<{ features: T[] }> {
  const features: T[] = [];
  for (let page = 0; page < maxPages; page++) {
    const q = new URLSearchParams({ where: "1=1", outFields, outSR: "4326", f: "geojson", orderByFields: orderBy, resultOffset: String(features.length) });
    const j = (await getJson(`${layerUrl}/query?${q}`, ctx)) as { features?: T[]; exceededTransferLimit?: boolean; properties?: { exceededTransferLimit?: boolean }; error?: { message?: string } };
    if (j.error) throw new Error(j.error.message ?? "ArcGIS error");
    features.push(...(j.features ?? []));
    if (!(j.exceededTransferLimit || j.properties?.exceededTransferLimit) || !j.features?.length) break;
  }
  return { features };
}

const CALTRANS_DISTRICTS = Array.from({ length: 12 }, (_, i) => i + 1);
const ARCGIS = {
  il: "https://services2.arcgis.com/aIrBD8yn1TDTEXoz/arcgis/rest/services/TrafficCamerasTM_Public/FeatureServer/0",
  wsdot: "https://data.wsdot.wa.gov/arcgis/rest/services/TravelInformation/TravelInfoCamerasWeather/FeatureServer/0",
  ia: "https://services.arcgis.com/8lRhdTsQyJpO52F1/arcgis/rest/services/Traffic_Cameras_View/FeatureServer/0",
  ky: "https://services2.arcgis.com/CcI36Pduqd0OR4W9/arcgis/rest/services/trafficCamerasCur_Prd/FeatureServer/0",
};
const OKTRAFFIC_CAMERAS = `https://oktraffic.org/api/CameraPoles?filter=${encodeURIComponent(JSON.stringify({ include: [{ relation: "mapCameras", scope: { include: "streamDictionary" } }] }))}`;
const TORONTO_CAMERAS = "https://ckan0.cf.opendata.inter.prod-toronto.ca/dataset/a3309088-5fd4-4d34-8297-77c8301840ac/resource/4a568300-c7f8-496d-b150-dff6f5dc6d4f/download/traffic-camera-list-4326.geojson";

export const camerasLayer: LiveLayerProvider<CamerasData> = {
  id: "cameras",
  name: "Public cameras",
  description:
    "Traffic and road-weather cameras published by transport agencies in London, New York City, California, Virginia, Maryland, Delaware, South Carolina, Alabama, Missouri, Oklahoma, Colorado, Indiana, Kansas, Nebraska, Washington, Illinois, Iowa, Kentucky, Texas (Austin), South Dakota, British Columbia, Toronto, Calgary, Spain, Iceland, Finland, Queensland, Hong Kong and Singapore. Thousands stream live video.",
  homepage: "https://tfl.gov.uk/info-for/open-data-users/",
  attribution: CAMERA_SOURCES.map((s) => s.name).join(" · "),
  // The camera list changes rarely; images are fetched live by the browser.
  ttlMs: 6 * 3_600_000,
  async load(ctx): Promise<LayerSnapshot<CamerasData>> {
    const tasks: Array<[string, () => Promise<CameraRow[]>]> = [
      ["tfl", async () => tflRows(await getJson("https://api.tfl.gov.uk/Place/Type/JamCam", ctx))],
      ["nyc", async () => nycRows(await getJson("https://webcams.nyctmc.org/api/cameras", ctx))],
      [
        "caltrans",
        async () => {
          const parts = await Promise.allSettled(
            CALTRANS_DISTRICTS.map(async (d) => caltransRows((await getJson(`https://cwwp2.dot.ca.gov/data/d${d}/cctv/cctvStatusD${String(d).padStart(2, "0")}.json`, ctx)).data)),
          );
          const rows = parts.flatMap((p) => (p.status === "fulfilled" ? p.value : []));
          if (!rows.length) throw new Error("no Caltrans districts loaded");
          return rows;
        },
      ],
      [
        "hk",
        async () => {
          const res = await fetch("https://static.data.gov.hk/td/traffic-snapshot-images/code/Traffic_Camera_Locations_En.csv", { signal: ctx.signal, headers: { "User-Agent": ctx.userAgent }, cache: "no-store" });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return hkRows(new TextDecoder("utf-16le").decode(await res.arrayBuffer()));
        },
      ],
      ["fi", async () => fiRows(await getJson("https://tie.digitraffic.fi/api/weathercam/v1/stations", ctx, { "Digitraffic-User": "WorldView/0.1", "Accept-Encoding": "gzip" }))],
      ["sg", async () => sgRows(await getJson("https://api.data.gov.sg/v1/transport/traffic-images", ctx))],
      ["dgt", async () => dgtRows(await getText("https://nap.dgt.es/datex2/v3/dgt/DevicePublication/camaras_datex2_v37.xml", ctx))],
      ["il", async () => ilRows(await arcgisFeatures(ARCGIS.il, "OBJECTID,ImgPath,CameraLocation,CameraDirection,SnapShot,TooOld", ctx))],
      ["wsdot", async () => wsdotRows(await arcgisFeatures(ARCGIS.wsdot, "OBJECTID,CameraTitle,ImageURL", ctx))],
      ["ia", async () => iaRows(await arcgisFeatures(ARCGIS.ia, "FID,Desc_,ImageName,ImageURL,VideoURL", ctx, "FID"))],
      ["bc", async () => bcRows(await getJson("https://www.drivebc.ca/api/webcams/", ctx))],
      ["is", async () => isRows(await getJson("https://gagnaveita.vegagerdin.is/api/vefmyndavelar2014_1", ctx))],
      ["to", async () => toRows(await getJson(TORONTO_CAMERAS, ctx))],
      ["cgy", async () => cgyRows(await getJson("https://data.calgary.ca/resource/k7p9-kppz.json?$limit=5000", ctx))],
      ["ky", async () => kyRows(await arcgisFeatures(ARCGIS.ky, "OBJECTID,name,description,snapshot", ctx))],
      ["qld", async () => qldRows(await getJson("https://data.qldtraffic.qld.gov.au/webcameras.geojson", ctx))],
      ["atx", async () => atxRows(await getJson("https://data.austintexas.gov/resource/b4k4-adkb.json?$select=camera_id,location_name,camera_status,screenshot_address,location&$limit=5000", ctx))],
      ["sd", async () => sdRows(await getJson("https://sd.cdn.iteris-atis.com/geojson/icons/metadata/icons.cameras.geojson", ctx))],
      ["va", async () => skylineRows((await getJson("https://511.vdot.virginia.gov/services/511/map/array/cameras", ctx)).data, "va")],
      ["sc", async () => skylineRows((await getJson("https://sc.cdn.iteris-atis.com/geojson/icons/metadata/icons.cameras.geojson", ctx)).features, "sc")],
      ["md", async () => mdRows(await getJson("https://chart.maryland.gov/DataFeeds/GetCamerasJson", ctx))],
      ["de", async () => deRows(await getJson("https://tmc.deldot.gov/json/videocamera.json", ctx))],
      ["mo", async () => moRows(await getJson("https://traveler.modot.org/timconfig/feed/desktop/StreamingCams2.json", ctx))],
      ...(["co", "in", "ks", "ne"] as const).map((st): [string, () => Promise<CameraRow[]>] => [st, async () => carsRows(await getJson(`https://${st}tg.carsprogram.org/cameras_v1/api/cameras`, ctx), st)]),
      ["al", async () => alRows(await getJson("https://api.algotraffic.com/v4.0/Cameras", ctx))],
      ["ok", async () => okRows(await getJson(OKTRAFFIC_CAMERAS, ctx))],
    ];
    const results = await Promise.allSettled(tasks.map(([, run]) => run()));
    const rows: CameraRow[] = [];
    const failed: string[] = [];
    results.forEach((r, i) => (r.status === "fulfilled" ? rows.push(...r.value) : failed.push(tasks[i][0])));
    // ~1 m precision is plenty for a map pin and keeps the payload small (some feeds send 15 decimals).
    for (const r of rows) {
      r[2] = Math.round(r[2] * 1e5) / 1e5;
      r[3] = Math.round(r[3] * 1e5) / 1e5;
    }
    if (!rows.length) throw new Error("No camera feeds could be loaded");
    const now = new Date().toISOString();
    return {
      layerId: "cameras",
      observedAt: now,
      retrievedAt: now,
      count: rows.length,
      data: { sources: CAMERA_SOURCES, rows, liveCount: rows.filter(isLiveVideo).length, failed },
      attribution: camerasLayer.attribution,
      notes: failed.length ? [`Unavailable: ${failed.join(", ")}`] : undefined,
    };
  },
};
