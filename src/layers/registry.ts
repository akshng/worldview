import "server-only";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { userAgent } from "@/lib/env";
import type { LayerSnapshot, LiveLayerProvider } from "./types";
import { aviationLayer } from "./aviation";
import { maritimeLayer } from "./maritime";
import { weatherRadarLayer } from "./weather-radar";
import { marketsLayer } from "./markets";
import { camerasLayer } from "./cameras";
import { issLayer } from "./iss";
import { auroraLayer } from "./aurora";
import { militaryAircraftLayer } from "./military-aircraft";
import { satellitesLayer } from "./satellites";

export const LAYERS = [
  weatherRadarLayer,
  aviationLayer,
  maritimeLayer,
  marketsLayer,
  camerasLayer,
  issLayer,
  auroraLayer,
  militaryAircraftLayer,
  satellitesLayer,
] as LiveLayerProvider<unknown>[];

interface CacheEntry {
  snapshot: LayerSnapshot | null;
  fetchedAt: number;
  inflight: Promise<LayerSnapshot> | null;
  error: string | null;
  errorAt: number | null;
}

const g = globalThis as unknown as { __worldviewLayers?: Map<string, CacheEntry>; __worldviewLayerBg?: boolean; __worldviewLayerBodies?: Map<string, LayerBody> };
const cache: Map<string, CacheEntry> = (g.__worldviewLayers ??= new Map());

export type LayerStatus = "OK" | "ERROR" | "DISABLED" | "IDLE";

export function layerHealth() {
  const env = process.env as Record<string, string | undefined>;
  return LAYERS.map((l) => {
    const c = cache.get(l.id);
    const disabled = l.checkConfiguration?.(env) ?? null;
    const status: LayerStatus = disabled ? "DISABLED" : !c ? "IDLE" : c.error && (!c.snapshot || (c.errorAt ?? 0) > c.fetchedAt) ? "ERROR" : "OK";
    return {
      id: l.id,
      name: l.name,
      description: l.description,
      homepage: l.homepage,
      ttlMs: l.ttlMs,
      status,
      disabledReason: disabled,
      lastFetchedAt: c?.fetchedAt ? new Date(c.fetchedAt).toISOString() : null,
      count: c?.snapshot?.count ?? null,
      error: c?.error ?? null,
    };
  });
}

function entryFor(id: string): CacheEntry {
  let c = cache.get(id);
  if (!c) cache.set(id, (c = { snapshot: null, fetchedAt: 0, inflight: null, error: null, errorAt: null }));
  return c;
}

/** Starts an upstream load unless one is already running. */
function refresh(layer: LiveLayerProvider<unknown>, c: CacheEntry): Promise<LayerSnapshot> {
  if (!c.inflight) {
    const env = process.env as Record<string, string | undefined>;
    c.inflight = layer
      .load({ signal: AbortSignal.timeout(60_000), userAgent: userAgent(), env, now: Date.now() })
      .then((snap) => {
        c.snapshot = snap;
        c.fetchedAt = Date.now();
        c.error = null;
        c.errorAt = null;
        return snap;
      })
      .catch((err: unknown) => {
        c.error = err instanceof Error ? err.message : String(err);
        c.errorAt = Date.now();
        throw err;
      })
      .finally(() => {
        c.inflight = null;
      });
  }
  return c.inflight;
}

/**
 * Cached, de-duplicated layer fetch. Serves the last good snapshot when the
 * upstream fails (with `stale: true`) so one bad response doesn't blank the map.
 * Background layers never make a request wait once they have a snapshot: an
 * expired one is served (`stale: true`) while a refresh runs.
 */
export async function getLayer(id: string): Promise<{ snapshot: LayerSnapshot; stale: boolean }> {
  const layer = LAYERS.find((l) => l.id === id);
  if (!layer) throw new LayerError(404, `Unknown layer "${id}"`);
  const env = process.env as Record<string, string | undefined>;
  const problem = layer.checkConfiguration?.(env);
  if (problem) throw new LayerError(503, problem);
  if (layer.background) startLayerBackground();

  const c = entryFor(id);
  const now = Date.now();
  const fresh = c.snapshot && now - c.fetchedAt < layer.ttlMs;
  // After a failure, wait at least a minute before hitting upstream again.
  const backingOff = c.errorAt !== null && now - c.errorAt < 60_000;
  if (fresh || (backingOff && c.snapshot)) return { snapshot: c.snapshot!, stale: !fresh };
  if (backingOff) throw new LayerError(502, c.error ?? "Layer unavailable");

  const pending = refresh(layer, c);
  if (layer.background && c.snapshot) {
    pending.catch(() => {});
    return { snapshot: c.snapshot, stale: true };
  }
  try {
    return { snapshot: await pending, stale: false };
  } catch (err) {
    if (c.snapshot) return { snapshot: c.snapshot, stale: true };
    throw new LayerError(502, err instanceof Error ? err.message : "Layer unavailable");
  }
}

/**
 * Loads background layers now and keeps them fresh: each refreshes at 90 % of its TTL
 * (retrying after 2 min on failure), so requests don't wait on upstream. Once per process;
 * called at server start (src/instrumentation.ts) and, as a fallback, on first use.
 */
export function startLayerBackground() {
  if (g.__worldviewLayerBg) return;
  g.__worldviewLayerBg = true;
  const env = process.env as Record<string, string | undefined>;
  for (const layer of LAYERS) {
    if (!layer.background || layer.checkConfiguration?.(env)) continue;
    const c = entryFor(layer.id);
    const tick = async () => {
      let delay = Math.max(60_000, layer.ttlMs * 0.9);
      try {
        await refresh(layer, c);
      } catch (err) {
        console.warn(`[layers] background refresh of ${layer.id} failed:`, err instanceof Error ? err.message : err);
        delay = 2 * 60_000;
      }
      setTimeout(tick, delay).unref?.();
    };
    void tick();
    layer.startBackground?.({ snapshot: () => c.snapshot, userAgent: userAgent() });
  }
}

export interface LayerBody {
  key: string;
  json: Buffer;
  gzip: Buffer;
  etag: string;
}
const bodies: Map<string, LayerBody> = (g.__worldviewLayerBodies ??= new Map());

/**
 * The API body for a layer, serialised and gzipped once per snapshot (and `presentKey`)
 * instead of on every request: the camera list is megabytes of JSON.
 */
export async function getLayerBody(id: string): Promise<LayerBody> {
  const { snapshot, stale } = await getLayer(id);
  const layer = LAYERS.find((l) => l.id === id)!;
  const key = `${snapshot.retrievedAt}|${stale}|${layer.presentKey?.() ?? ""}`;
  const hit = bodies.get(id);
  if (hit?.key === key) return hit;
  const data = layer.present ? layer.present(snapshot.data) : snapshot.data;
  const json = Buffer.from(JSON.stringify({ ...snapshot, data, stale }));
  const body: LayerBody = { key, json, gzip: gzipSync(json, { level: 6 }), etag: `"${createHash("sha1").update(json).digest("base64url").slice(0, 22)}"` };
  bodies.set(id, body);
  return body;
}

export class LayerError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
