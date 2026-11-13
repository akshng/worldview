/**
 * Background liveness sampler for camera sources. Every 30 min it fetches a small random
 * sample of each source's stills and stream playlists (6 + 6 per source), one request at a
 * time per operator and at most 6 in flight overall, and records the share that respond.
 * The camera list uses it to hide fully dead sources and to flag "live video" only where
 * streams are healthy. Nothing here downloads video: playlists are a few hundred bytes and
 * image bodies are cut off after the first 64 KB.
 */
import { firstVariant, hasDrm, isPlaylist, sample, summarizeProbes, type ProbeKind, type ProbeResult, type SourceHealth } from "@/lib/cameras";

export const HEALTH_INTERVAL_MS = 30 * 60_000;
const PER_SOURCE = 6;
const CONCURRENCY = 6;
const TIMEOUT_MS = 8_000;

interface HealthState {
  health: Record<string, SourceHealth>;
  /** Bumped after each round (for response caching). */
  version: number;
  timer: ReturnType<typeof setTimeout> | null;
  running: boolean;
  /** The last round was skipped because every probe failed (offline). */
  skipped?: boolean;
}
const g = globalThis as unknown as { __worldviewCamHealth?: HealthState };
const state: HealthState = (g.__worldviewCamHealth ??= { health: {}, version: 0, timer: null, running: false });

export const cameraHealth = () => state.health;
export const cameraHealthVersion = () => state.version;

export interface ProbeTarget {
  source: string;
  kind: ProbeKind;
  url: string;
}

/** Up to `perSource` stills and `perSource` streams from each source. */
export function probeTargets(rows: Array<{ source: string; image: string; video: string | null; kind: string | null }>, perSource = PER_SOURCE, rand: () => number = Math.random): ProbeTarget[] {
  const by = new Map<string, { still: string[]; video: string[] }>();
  for (const r of rows) {
    const b = by.get(r.source) ?? { still: [], video: [] };
    by.set(r.source, b);
    if (r.image) b.still.push(r.image);
    if (r.video && r.kind === "hls") b.video.push(r.video);
  }
  const out: ProbeTarget[] = [];
  for (const [source, b] of by) {
    for (const url of sample(b.still, perSource, rand)) out.push({ source, kind: "still", url });
    for (const url of sample(b.video, perSource, rand)) out.push({ source, kind: "video", url });
  }
  return out;
}

async function get(url: string, userAgent: string) {
  return fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { "User-Agent": userAgent }, cache: "no-store", redirect: "follow" });
}

/** A still is alive when it returns an image (or untyped bytes, which browsers sniff) of more than 1 KB. */
async function probeStill(url: string, userAgent: string): Promise<boolean> {
  const res = await get(url, userAgent);
  const ct = res.headers.get("content-type") ?? "";
  if (!res.ok || !/^(image\/|application\/octet-stream|binary\/octet-stream)/.test(ct) || !res.body) {
    await res.body?.cancel().catch(() => {});
    return false;
  }
  let bytes = 0;
  const reader = res.body.getReader();
  try {
    while (bytes < 64_000) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return bytes > 1_000;
}

/**
 * A stream is alive when its playlist (and, for a master playlist, its first variant) parses
 * and isn't DRM-protected (browsers can't play those).
 */
async function probeStream(url: string, userAgent: string): Promise<boolean> {
  const res = await get(url, userAgent);
  if (!res.ok) return false;
  const text = await res.text();
  if (!isPlaylist(text) || hasDrm(text)) return false;
  const variant = firstVariant(text, res.url || url);
  if (!variant) return true;
  const v = await get(variant, userAgent);
  if (!v.ok) return false;
  const vt = await v.text();
  return isPlaylist(vt) && !hasDrm(vt);
}

export async function probe(t: ProbeTarget, userAgent: string): Promise<boolean> {
  try {
    return await (t.kind === "still" ? probeStill(t.url, userAgent) : probeStream(t.url, userAgent));
  } catch {
    return false;
  }
}

/** Runs probes with at most `concurrency` in flight and only one per source at a time. */
export async function runProbes(targets: ProbeTarget[], check: (t: ProbeTarget) => Promise<boolean>, concurrency = CONCURRENCY): Promise<ProbeResult[]> {
  const queues = new Map<string, ProbeTarget[]>();
  for (const t of targets) queues.set(t.source, [...(queues.get(t.source) ?? []), t]);
  const busy = new Set<string>();
  const results: ProbeResult[] = [];
  await new Promise<void>((resolve) => {
    let active = 0;
    const pump = () => {
      if (active === 0 && [...queues.values()].every((q) => !q.length)) return resolve();
      for (const [source, q] of queues) {
        if (active >= concurrency) break;
        if (busy.has(source) || !q.length) continue;
        const t = q.shift()!;
        busy.add(source);
        active++;
        void check(t)
          .catch(() => false)
          .then((ok) => {
            results.push({ source: t.source, kind: t.kind, ok });
            busy.delete(source);
            active--;
            pump();
          });
      }
    };
    pump();
  });
  return results;
}

/** True when there were probes and none succeeded (the network, not the cameras, is down). */
export function allFailed(results: ProbeResult[]): boolean {
  return results.length > 0 && results.every((r) => !r.ok);
}

/** One sampling round over the current rows. Skipped (previous health kept) when every probe fails. */
export async function sampleCameraHealth(targets: ProbeTarget[], userAgent: string): Promise<Record<string, SourceHealth>> {
  if (state.running) return state.health;
  state.running = true;
  try {
    const results = await runProbes(targets, (t) => probe(t, userAgent));
    if (allFailed(results)) {
      // Every probe across every operator failing means we're offline (or just woke from
      // sleep), not that ~30 agencies died at once: keep the previous health, retry later.
      console.info(`[cameras] liveness round skipped: all ${results.length} probes failed (offline?)`);
      state.skipped = true;
      return state.health;
    }
    const health = summarizeProbes(results, new Date().toISOString());
    state.skipped = false;
    state.health = health;
    state.version++;
    const line = Object.entries(health)
      .map(([s, h]) => `${s} ${h.stillN ? `${h.stillOk}/${h.stillN}` : "-"}${h.videoN ? ` v${h.videoOk}/${h.videoN}` : ""}`)
      .join(", ");
    console.info(`[cameras] liveness sampled: ${line}`);
    return health;
  } finally {
    state.running = false;
  }
}

/** Starts the 30-min sampler once per process. `targets` is called each round with the current list. */
export function startCameraHealth(targets: () => ProbeTarget[] | null, userAgent: string, firstDelayMs = 20_000) {
  if (state.timer) return;
  const round = async () => {
    const t = targets();
    if (t?.length) await sampleCameraHealth(t, userAgent).catch((e) => console.warn("[cameras] liveness sampling failed", e));
    // Offline round (all probes failed): try again in 5 min instead of waiting 30.
    state.timer = setTimeout(round, !t?.length ? 60_000 : state.skipped ? 5 * 60_000 : HEALTH_INTERVAL_MS);
    state.timer.unref?.();
  };
  state.timer = setTimeout(round, firstDelayMs);
  state.timer.unref?.();
}
