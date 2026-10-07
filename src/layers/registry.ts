import "server-only";
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

const g = globalThis as unknown as { __worldviewLayers?: Map<string, CacheEntry> };
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

/**
 * Cached, de-duplicated layer fetch. Serves the last good snapshot when the
 * upstream fails (with `stale: true`) so one bad response doesn't blank the map.
 */
export async function getLayer(id: string): Promise<{ snapshot: LayerSnapshot; stale: boolean }> {
  const layer = LAYERS.find((l) => l.id === id);
  if (!layer) throw new LayerError(404, `Unknown layer "${id}"`);
  const env = process.env as Record<string, string | undefined>;
  const problem = layer.checkConfiguration?.(env);
  if (problem) throw new LayerError(503, problem);

  let c = cache.get(id);
  if (!c) cache.set(id, (c = { snapshot: null, fetchedAt: 0, inflight: null, error: null, errorAt: null }));
  const now = Date.now();
  const fresh = c.snapshot && now - c.fetchedAt < layer.ttlMs;
  // After a failure, wait at least a minute before hitting upstream again.
  const backingOff = c.errorAt !== null && now - c.errorAt < 60_000;
  if (fresh || (backingOff && c.snapshot)) return { snapshot: c.snapshot!, stale: !fresh };
  if (backingOff) throw new LayerError(502, c.error ?? "Layer unavailable");

  if (!c.inflight) {
    const entry = c;
    entry.inflight = layer
      .load({ signal: AbortSignal.timeout(60_000), userAgent: userAgent(), env, now })
      .then((snap) => {
        entry.snapshot = snap;
        entry.fetchedAt = Date.now();
        entry.error = null;
        entry.errorAt = null;
        return snap;
      })
      .catch((err: unknown) => {
        entry.error = err instanceof Error ? err.message : String(err);
        entry.errorAt = Date.now();
        throw err;
      })
      .finally(() => {
        entry.inflight = null;
      });
  }
  try {
    return { snapshot: await c.inflight!, stale: false };
  } catch (err) {
    if (c.snapshot) return { snapshot: c.snapshot, stale: true };
    throw new LayerError(502, err instanceof Error ? err.message : "Layer unavailable");
  }
}

export class LayerError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
