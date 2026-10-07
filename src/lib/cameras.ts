/**
 * Camera list format and media logic shared by the server (cameras layer, liveness sampler,
 * /api/cameras/[id]) and the client (map markers, viewer). Pure: no I/O.
 *
 * The map list is compact: one row per camera without media URLs, which the viewer fetches
 * on click from /api/cameras/[id]. That keeps the list small (the URLs were ~60 % of it).
 */

/** [id, name, lon, lat, sourceIndex, flags] */
export type CameraListRow = [string, string, number, number, number, number];

export const CAM_STILL = 1;
export const CAM_HLS = 2;
export const CAM_MP4 = 4;
/** Has an HLS stream and its source's sampled streams are healthy: drawn as "live video" on the map. */
export const CAM_LIVE = 8;

export type VideoKind = "hls" | "mp4";

/** Media for one camera, from /api/cameras/[id]. */
export interface CameraMedia {
  id: string;
  image: string | null;
  video: string | null;
  videoKind: VideoKind | null;
  /** Ask again for each still refresh: the operator publishes a new URL per frame. */
  volatileImage?: boolean;
}

/** Sampled liveness of one source's media (background sampler). */
export interface SourceHealth {
  stillOk: number;
  stillN: number;
  videoOk: number;
  videoN: number;
  /** ISO time of the last sampling round */
  checkedAt: string;
}

export type ProbeKind = "still" | "video";
export interface ProbeResult {
  source: string;
  kind: ProbeKind;
  ok: boolean;
}

/** Below this share of sampled streams responding, a source's streams aren't flagged "live video". */
export const HEALTHY_VIDEO_SHARE = 0.5;
/** Minimum samples before a source's health counts. */
export const MIN_SAMPLES = 3;

export const pct = (ok: number, n: number): number | null => (n > 0 ? Math.round((100 * ok) / n) : null);

/** Streams of a source are healthy unless enough were sampled and too few responded. Unknown counts as healthy. */
export function videoHealthy(h: SourceHealth | undefined): boolean {
  return !h || h.videoN < MIN_SAMPLES || h.videoOk / h.videoN >= HEALTHY_VIDEO_SHARE;
}

/** Every sampled still and stream failed (with enough samples to be sure). */
export function sourceDead(h: SourceHealth | undefined): boolean {
  if (!h) return false;
  const n = h.stillN + h.videoN;
  return n >= MIN_SAMPLES && h.stillOk + h.videoOk === 0;
}

/**
 * Sources to hide from the map: fully dead ones. If most sources look dead at once the
 * problem is our own network, not the operators, so nothing is hidden.
 */
export function deadSources(health: Record<string, SourceHealth>): string[] {
  const ids = Object.keys(health);
  const dead = ids.filter((id) => sourceDead(health[id]));
  return dead.length > ids.length / 2 ? [] : dead.sort();
}

/** Aggregates one sampling round into per-source health. */
export function summarizeProbes(results: ProbeResult[], checkedAt: string): Record<string, SourceHealth> {
  const out: Record<string, SourceHealth> = {};
  for (const r of results) {
    const h = (out[r.source] ??= { stillOk: 0, stillN: 0, videoOk: 0, videoN: 0, checkedAt });
    if (r.kind === "still") {
      h.stillN++;
      if (r.ok) h.stillOk++;
    } else {
      h.videoN++;
      if (r.ok) h.videoOk++;
    }
  }
  return out;
}

/** Up to `n` distinct random items (partial Fisher–Yates; `rand` injectable for tests). */
export function sample<T>(items: readonly T[], n: number, rand: () => number = Math.random): T[] {
  const a = items.slice();
  const k = Math.min(n, a.length);
  for (let i = 0; i < k; i++) {
    const j = i + Math.floor(rand() * (a.length - i));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, k);
}

/** A response body looks like a usable HLS playlist (master or media). */
export const isPlaylist = (text: string) => text.trimStart().startsWith("#EXTM3U") && /#EXTINF|#EXT-X-STREAM-INF/.test(text);

/**
 * The playlist is DRM-protected (SAMPLE-AES / FairPlay `skd://` keys), which browsers can't
 * play without a licence (e.g. ALGO Traffic's Wowza streams). Plain AES-128 is fine.
 */
export const hasDrm = (text: string) => /#EXT-X-(?:SESSION-)?KEY:[^\n]*(?:METHOD=SAMPLE-AES|URI="skd:)/.test(text);

/** First URI in a master playlist (the first variant), resolved against the playlist URL. */
export function firstVariant(text: string, base: string): string | null {
  if (!/#EXT-X-STREAM-INF/.test(text)) return null;
  const line = text.split(/\r?\n/).find((l) => l.trim() && !l.startsWith("#"));
  try {
    return line ? new URL(line.trim(), base).toString() : null;
  } catch {
    return null;
  }
}

export type MediaStep = "hls" | "mp4" | "still";

/**
 * Order in which the viewer tries a camera's media: live HLS → MP4 clip → still. When the
 * source's streams are unhealthy and a still exists, the still goes first (the stream stays
 * available as a manual choice).
 */
export function mediaPlan(m: Pick<CameraMedia, "image" | "video" | "videoKind">, streamsHealthy = true): MediaStep[] {
  const plan: MediaStep[] = [];
  if (m.video && m.videoKind === "hls") plan.push("hls");
  if (m.video && m.videoKind === "mp4") plan.push("mp4");
  if (m.image) {
    if (!streamsHealthy && plan[0] === "hls") plan.unshift("still");
    else plan.push("still");
  }
  return plan;
}

export const hasLive = (r: CameraListRow) => (r[5] & CAM_LIVE) !== 0;

/** The flags for a camera with these media. */
export function cameraFlags(image: string, video: string | null, kind: VideoKind | null, streamsHealthy: boolean): number {
  let f = image ? CAM_STILL : 0;
  if (video && kind === "hls") f |= CAM_HLS | (streamsHealthy ? CAM_LIVE : 0);
  if (video && kind === "mp4") f |= CAM_MP4;
  return f;
}
