import "server-only";
import { getRepository } from "@/lib/server/context";
import { haversineKm } from "@/lib/geo/math";
import { CHOKEPOINTS, chokepointStatus, type ChokepointMonitor, type ScoredEvent } from "./chokepoints";

export type { ChokepointMonitor };

const cache = new Map<string, { at: number; data: ChokepointMonitor }>();
const TTL_MS = 2 * 60_000;

/**
 * Recent WorldView events inside each chokepoint's radius, with a disruption
 * score. Country-precision events are skipped: they sit at a country centroid,
 * not at the strait.
 */
export async function getChokepointMonitor(days: number): Promise<ChokepointMonitor> {
  const repo = await getRepository();
  const key = `${days}:${repo.version()}`;
  const hit = cache.get(key);
  const now = Date.now();
  if (hit && now - hit.at < TTL_MS) return hit.data;
  const fromMs = now - days * 86_400_000;
  const chokepoints = await Promise.all(
    CHOKEPOINTS.map(async (c) => {
      const near = await repo.findNear({ lat: c.lat, lon: c.lon, radiusKm: c.radiusKm, fromMs, toMs: now });
      const events: ScoredEvent[] = near
        .filter((e) => e.geoPrecision !== "country" && !e.isSynthetic)
        .map((e) => ({
          id: e.id,
          type: e.type,
          title: e.title,
          timestamp: e.timestamp,
          importanceScore: e.importanceScore,
          distanceKm: Math.round(haversineKm(c.lat, c.lon, e.latitude, e.longitude)),
        }));
      return chokepointStatus(c, events, now);
    }),
  );
  chokepoints.sort((a, b) => b.score - a.score || b.total - a.total);
  const data = { generatedAt: new Date(now).toISOString(), days, chokepoints };
  cache.clear();
  cache.set(key, { at: now, data });
  return data;
}
