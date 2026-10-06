/**
 * Public cameras from official open-data feeds (keyless). Only cameras that their
 * operators publish for public viewing — traffic and road-weather cameras.
 * The browser loads each image/stream directly from the operator.
 *
 * Row: [id, name, lon, lat, sourceIndex, imageUrl, videoUrl | null, videoKind | null]
 */
import type { LayerContext, LayerSnapshot, LiveLayerProvider } from "../types";

export type CameraRow = [string, string, number, number, number, string, string | null, "mp4" | "hls" | null];

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
  failed: string[];
}

export const CAMERA_SOURCES: CameraSource[] = [
  { id: "tfl", name: "Transport for London JamCams", region: "London, UK", homepage: "https://tfl.gov.uk/traffic/status/", license: "TfL open data (Open Government Licence)", refreshSec: 300 },
  { id: "nyc", name: "NYC DOT traffic cameras", region: "New York City, US", homepage: "https://webcams.nyctmc.org/", license: "NYC DOT public cameras", refreshSec: 2 },
  { id: "caltrans", name: "Caltrans CCTV", region: "California, US", homepage: "https://cwwp2.dot.ca.gov/", license: "California Department of Transportation public data", refreshSec: 60 },
  { id: "hk", name: "Hong Kong Transport Department", region: "Hong Kong", homepage: "https://data.gov.hk/en-data/dataset/hk-td-tis_2-traffic-snapshot-images", license: "DATA.GOV.HK terms", refreshSec: 120 },
  { id: "fi", name: "Fintraffic road weather cameras", region: "Finland", homepage: "https://www.digitraffic.fi/en/road-traffic/", license: "Fintraffic / digitraffic.fi, CC BY 4.0", refreshSec: 600 },
  { id: "sg", name: "Singapore LTA traffic cameras", region: "Singapore", homepage: "https://data.gov.sg/", license: "Singapore Open Data Licence", refreshSec: 60 },
];
const IDX = Object.fromEntries(CAMERA_SOURCES.map((s, i) => [s.id, i]));

const ok = (lat: number, lon: number) => Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0);
const https = (u: unknown) => (typeof u === "string" && /^https:\/\//.test(u) ? u : null);

async function getJson(url: string, ctx: LayerContext, headers: Record<string, string> = {}) {
  const res = await fetch(url, { signal: ctx.signal, headers: { "User-Agent": ctx.userAgent, Accept: "application/json", ...headers }, cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
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
    const vid = https(c.imageData?.streamingVideoURL);
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

const CALTRANS_DISTRICTS = Array.from({ length: 12 }, (_, i) => i + 1);

export const camerasLayer: LiveLayerProvider<CamerasData> = {
  id: "cameras",
  name: "Public cameras",
  description: "Traffic and road-weather cameras published as open data by London, New York City, California, Hong Kong, Finland and Singapore.",
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
    ];
    const results = await Promise.allSettled(tasks.map(([, run]) => run()));
    const rows: CameraRow[] = [];
    const failed: string[] = [];
    results.forEach((r, i) => (r.status === "fulfilled" ? rows.push(...r.value) : failed.push(tasks[i][0])));
    if (!rows.length) throw new Error("No camera feeds could be loaded");
    const now = new Date().toISOString();
    return {
      layerId: "cameras",
      observedAt: now,
      retrievedAt: now,
      count: rows.length,
      data: { sources: CAMERA_SOURCES, rows, failed },
      attribution: camerasLayer.attribution,
      notes: failed.length ? [`Unavailable: ${failed.join(", ")}`] : undefined,
    };
  },
};
