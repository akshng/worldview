/**
 * International Space Station position and ground track from wheretheiss.at
 * (keyless). Positions are computed by wheretheiss.at from the latest published
 * orbital elements (TLE) — they are model positions, not radar observations.
 *
 * The current position is cached for a few seconds; the ±90-minute ground track
 * (61 points, 3 minutes apart) is refreshed every 5 minutes in chunks of 10
 * timestamps, as the API documents.
 */
import { httpGet } from "@/data-sources/types";
import type { LayerContext, LiveLayerProvider } from "../types";

const API = "https://api.wheretheiss.at/v1/satellites/25544";
export const TRACK_SPAN_SEC = 90 * 60;
export const TRACK_STEP_SEC = 180;
const TRACK_TTL_MS = 5 * 60_000;
const CHUNK = 10;

export interface IssPosition {
  lon: number;
  lat: number;
  altKm: number;
  speedKmh: number;
  /** wheretheiss.at: "daylight" (station sunlit) or "eclipsed" (in Earth's shadow) */
  visibility: string;
  footprintKm: number | null;
  /** ISO time the position refers to */
  time: string;
  /** Whether the ground directly below is in daylight (from the sub-solar point), null if unknown */
  groundDaylight: boolean | null;
}

export interface IssTrack {
  /** [lon, lat, unixSeconds] samples, oldest first */
  points: Array<[number, number, number]>;
  computedAt: string;
}

export interface IssData {
  position: IssPosition;
  track: IssTrack | null;
}

interface RawIss {
  latitude?: unknown;
  longitude?: unknown;
  altitude?: unknown;
  velocity?: unknown;
  visibility?: unknown;
  footprint?: unknown;
  timestamp?: unknown;
  solar_lat?: unknown;
  solar_lon?: unknown;
  units?: unknown;
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const wrapLon = (lon: number) => (lon >= -180 && lon <= 180 ? lon : ((((lon + 180) % 360) + 360) % 360) - 180);

/** Whether `p` is on the day side, given the sub-solar point (great-circle angle < 90°). */
export function isDaylight(lat: number, lon: number, solarLat: number, solarLon: number): boolean {
  const r = Math.PI / 180;
  const cos = Math.sin(lat * r) * Math.sin(solarLat * r) + Math.cos(lat * r) * Math.cos(solarLat * r) * Math.cos((lon - solarLon) * r);
  return cos > 0;
}

/** Parse one wheretheiss.at satellite record (units=kilometers). Returns null if unusable. */
export function parseIssPosition(raw: unknown): IssPosition | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as RawIss;
  const lat = num(r.latitude);
  const lon = num(r.longitude);
  const alt = num(r.altitude);
  const vel = num(r.velocity);
  const ts = num(r.timestamp);
  if (lat === null || lon === null || alt === null || vel === null || ts === null || Math.abs(lat) > 90) return null;
  const miles = r.units === "miles";
  const k = miles ? 1.609344 : 1;
  const sLat = num(r.solar_lat);
  const sLon = num(r.solar_lon);
  const fp = num(r.footprint);
  return {
    lon: wrapLon(lon),
    lat,
    altKm: alt * k,
    speedKmh: vel * k,
    visibility: typeof r.visibility === "string" ? r.visibility : "unknown",
    footprintKm: fp === null ? null : fp * k,
    time: new Date(ts * 1000).toISOString(),
    groundDaylight: sLat === null || sLon === null ? null : isDaylight(lat, lon, sLat, sLon),
  };
}

/** Parse a /positions response into [lon, lat, t] samples sorted by time. */
export function parseTrack(raw: unknown): Array<[number, number, number]> {
  if (!Array.isArray(raw)) return [];
  const out: Array<[number, number, number]> = [];
  for (const r of raw as RawIss[]) {
    const lat = num(r?.latitude);
    const lon = num(r?.longitude);
    const ts = num(r?.timestamp);
    if (lat === null || lon === null || ts === null || Math.abs(lat) > 90) continue;
    out.push([wrapLon(lon), lat, ts]);
  }
  return out.sort((a, b) => a[2] - b[2]);
}

/** Timestamps (unix s) for a ±span track around `nowSec`, in API-sized chunks. */
export function trackTimestamps(nowSec: number, spanSec = TRACK_SPAN_SEC, stepSec = TRACK_STEP_SEC): number[][] {
  const base = Math.floor(nowSec / stepSec) * stepSec;
  const all: number[] = [];
  for (let t = base - spanSec; t <= base + spanSec; t += stepSec) all.push(t);
  const chunks: number[][] = [];
  for (let i = 0; i < all.length; i += CHUNK) chunks.push(all.slice(i, i + CHUNK));
  return chunks;
}

/**
 * Split a track into line segments at the antimeridian (interpolating the
 * crossing latitude) so lines never wrap the long way round the globe.
 */
export function splitAntimeridian(points: Array<[number, number]>): Array<Array<[number, number]>> {
  const lines: Array<Array<[number, number]>> = [];
  let cur: Array<[number, number]> = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const prev = points[i - 1];
    if (prev && Math.abs(p[0] - prev[0]) > 180) {
      const east = prev[0] > 0; // crossing eastwards past +180
      const lon2 = east ? p[0] + 360 : p[0] - 360;
      const edge = east ? 180 : -180;
      const f = (edge - prev[0]) / (lon2 - prev[0]);
      const lat = prev[1] + f * (p[1] - prev[1]);
      cur.push([edge, lat]);
      if (cur.length > 1) lines.push(cur);
      cur = [[-edge, lat]];
    }
    cur.push(p);
  }
  if (cur.length > 1) lines.push(cur);
  return lines;
}

/** GeoJSON for the map: the station point, and the past / upcoming ground track. */
export function issFeatures(data: IssData): { point: GeoJSON.FeatureCollection; track: GeoJSON.FeatureCollection } {
  const p = data.position;
  const point: GeoJSON.FeatureCollection = {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: [p.lon, p.lat] },
        properties: { altKm: p.altKm, speedKmh: p.speedKmh, visibility: p.visibility, groundDaylight: p.groundDaylight, time: p.time },
      },
    ],
  };
  const features: GeoJSON.Feature[] = [];
  if (data.track && data.track.points.length > 1) {
    const nowSec = Date.parse(p.time) / 1000;
    const past = data.track.points.filter((q) => q[2] <= nowSec).map((q) => [q[0], q[1]] as [number, number]);
    const future = data.track.points.filter((q) => q[2] > nowSec).map((q) => [q[0], q[1]] as [number, number]);
    // Join both halves at the current position so the line passes through the station.
    past.push([p.lon, p.lat]);
    future.unshift([p.lon, p.lat]);
    for (const [part, pts] of [["past", past], ["future", future]] as const) {
      const lines = splitAntimeridian(pts);
      if (lines.length) features.push({ type: "Feature", geometry: { type: "MultiLineString", coordinates: lines }, properties: { part } });
    }
  }
  return { point, track: { type: "FeatureCollection", features } };
}

// ---- server-side cache for the ground track ------------------------------------

const g = globalThis as unknown as { __worldviewIssTrack?: { track: IssTrack | null; fetchedAt: number; inflight: Promise<IssTrack> | null } };
const trackCache = (g.__worldviewIssTrack ??= { track: null, fetchedAt: 0, inflight: null });

async function fetchTrack(ctx: Pick<LayerContext, "signal" | "userAgent" | "now">): Promise<IssTrack> {
  const points: Array<[number, number, number]> = [];
  // Sequential: a handful of small requests every 5 minutes, well inside the 350 / 5 min limit.
  for (const chunk of trackTimestamps(Math.floor(ctx.now / 1000))) {
    const res = await httpGet(`${API}/positions?timestamps=${chunk.join(",")}&units=kilometers`, ctx);
    points.push(...parseTrack(await res.json()));
  }
  if (points.length < 2) throw new Error("ISS track: no positions returned");
  return { points: points.sort((a, b) => a[2] - b[2]), computedAt: new Date(ctx.now).toISOString() };
}

function refreshTrack(ctx: LayerContext): Promise<IssTrack> {
  if (!trackCache.inflight) {
    trackCache.inflight = fetchTrack(ctx)
      .then((t) => {
        trackCache.track = t;
        trackCache.fetchedAt = Date.now();
        return t;
      })
      .finally(() => {
        trackCache.inflight = null;
      });
  }
  return trackCache.inflight;
}

export const issLayer: LiveLayerProvider<IssData> = {
  id: "iss",
  name: "International Space Station (wheretheiss.at)",
  description: "ISS position every few seconds and its ground track ±90 minutes, computed by wheretheiss.at from the latest orbital elements.",
  homepage: "https://wheretheiss.at/w/developer",
  attribution: "ISS position: wheretheiss.at",
  ttlMs: 5_000,
  async load(ctx) {
    const position = parseIssPosition(await (await httpGet(`${API}?units=kilometers`, ctx)).json());
    if (!position) throw new Error("ISS: unexpected response");
    let track = trackCache.track;
    const stale = Date.now() - trackCache.fetchedAt > TRACK_TTL_MS;
    if (!track) {
      // First load: wait for the track, but a failure must not hide the position.
      track = await refreshTrack(ctx).catch(() => null);
    } else if (stale) {
      // Refresh in the background with its own timeout; serve the cached track meanwhile.
      void refreshTrack({ ...ctx, signal: AbortSignal.timeout(30_000) }).catch(() => {});
    }
    return {
      layerId: "iss",
      observedAt: position.time,
      retrievedAt: new Date(ctx.now).toISOString(),
      count: 1,
      data: { position, track },
      attribution: this.attribution,
      notes: [
        "Position and track are computed from the latest published orbital elements (TLE), not observed directly.",
        ...(track ? [] : ["Ground track temporarily unavailable."]),
      ],
    };
  },
};
