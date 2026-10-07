/**
 * Maritime chokepoints (curated) and the disruption score used by the
 * chokepoint monitor. Pure — shared by the API route, the map and tests.
 */
import type { EventCategory } from "@/types/events";

export interface Chokepoint {
  id: string;
  name: string;
  lon: number;
  lat: number;
  /** Monitoring radius around the centre, km */
  radiusKm: number;
  /** Factual one-liner: what it connects */
  connects: string;
}

export const CHOKEPOINTS: Chokepoint[] = [
  { id: "hormuz", name: "Strait of Hormuz", lon: 56.4, lat: 26.5, radiusKm: 150, connects: "Persian Gulf ↔ Gulf of Oman" },
  { id: "bab-el-mandeb", name: "Bab el-Mandeb", lon: 43.4, lat: 12.6, radiusKm: 120, connects: "Red Sea ↔ Gulf of Aden" },
  { id: "suez", name: "Suez Canal", lon: 32.45, lat: 30.6, radiusKm: 110, connects: "Mediterranean ↔ Red Sea" },
  { id: "malacca", name: "Strait of Malacca", lon: 101.5, lat: 2.6, radiusKm: 300, connects: "Andaman Sea ↔ South China Sea (via Singapore Strait)" },
  { id: "bosporus", name: "Bosporus", lon: 29.06, lat: 41.12, radiusKm: 50, connects: "Black Sea ↔ Sea of Marmara" },
  { id: "panama", name: "Panama Canal", lon: -79.7, lat: 9.1, radiusKm: 80, connects: "Caribbean ↔ Pacific" },
  { id: "gibraltar", name: "Strait of Gibraltar", lon: -5.6, lat: 35.95, radiusKm: 80, connects: "Atlantic ↔ Mediterranean" },
  { id: "taiwan", name: "Taiwan Strait", lon: 119.6, lat: 24.3, radiusKm: 220, connects: "East China Sea ↔ South China Sea" },
  { id: "kerch", name: "Kerch Strait", lon: 36.55, lat: 45.3, radiusKm: 60, connects: "Sea of Azov ↔ Black Sea" },
  { id: "dover", name: "Strait of Dover", lon: 1.45, lat: 51.0, radiusKm: 60, connects: "English Channel ↔ North Sea" },
  { id: "danish", name: "Danish straits", lon: 11.6, lat: 55.6, radiusKm: 130, connects: "Kattegat ↔ Baltic Sea (Øresund, Great and Little Belt)" },
  { id: "lombok", name: "Lombok Strait", lon: 115.75, lat: -8.75, radiusKm: 70, connects: "Indian Ocean ↔ Java/Flores Seas" },
  { id: "good-hope", name: "Cape of Good Hope", lon: 18.47, lat: -34.36, radiusKm: 200, connects: "Atlantic ↔ Indian Ocean (Suez alternative)" },
];

/** Circle polygon (approximate, 48 vertices) for drawing a chokepoint's radius. */
export function circleRing(lon: number, lat: number, radiusKm: number, steps = 48): [number, number][] {
  const ring: [number, number][] = [];
  const dLat = radiusKm / 111.32;
  const dLon = radiusKm / (111.32 * Math.max(Math.cos((lat * Math.PI) / 180), 0.05));
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * 2 * Math.PI;
    ring.push([Math.round((lon + dLon * Math.cos(a)) * 1e4) / 1e4, Math.round((lat + dLat * Math.sin(a)) * 1e4) / 1e4]);
  }
  ring[steps] = ring[0];
  return ring;
}

export function chokepointFeatures(scores?: Map<string, ChokepointStatus>): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const c of CHOKEPOINTS) {
    const s = scores?.get(c.id);
    const props = { id: c.id, name: c.name, connects: c.connects, radiusKm: c.radiusKm, score: s?.score ?? -1, events: s?.total ?? -1 };
    features.push({ type: "Feature", geometry: { type: "Polygon", coordinates: [circleRing(c.lon, c.lat, c.radiusKm)] }, properties: { ...props, kind: "area" } });
    features.push({ type: "Feature", geometry: { type: "Point", coordinates: [c.lon, c.lat] }, properties: { ...props, kind: "centre" } });
  }
  return { type: "FeatureCollection", features };
}

/** How much each category counts toward disruption at a chokepoint. Unlisted: 0.3. */
export const CATEGORY_WEIGHT: Partial<Record<EventCategory, number>> = {
  CONFLICT: 1.5,
  MARITIME: 1.3,
  INFRASTRUCTURE: 1.0,
  PROTEST: 0.6,
  WEATHER: 0.8,
  DISASTER: 0.9,
  EARTHQUAKE: 0.6,
  FLOOD: 0.6,
  POLITICS: 0.5,
  NEWS: 0.4,
};

export interface ScoredEvent {
  id: string;
  type: EventCategory;
  title: string;
  timestamp: string;
  importanceScore: number;
  distanceKm: number;
}

export type DisruptionLevel = "calm" | "watch" | "elevated" | "high";

export interface ChokepointStatus {
  id: string;
  name: string;
  lon: number;
  lat: number;
  radiusKm: number;
  connects: string;
  total: number;
  byCategory: Partial<Record<EventCategory, number>>;
  score: number;
  level: DisruptionLevel;
  top: ScoredEvent[];
}

/**
 * Simple, transparent disruption score 0–100:
 *   weight = importance/100 × category weight × recency (half-life 48 h)
 *   score  = 100 × (1 − e^(−Σweight / 3))
 * so one critical conflict event today ≈ 35; several push it past 60.
 */
export function disruptionScore(events: Pick<ScoredEvent, "type" | "timestamp" | "importanceScore">[], nowMs: number): number {
  let sum = 0;
  for (const e of events) {
    const ageH = Math.max(0, (nowMs - Date.parse(e.timestamp)) / 3_600_000);
    sum += (e.importanceScore / 100) * (CATEGORY_WEIGHT[e.type] ?? 0.3) * Math.pow(0.5, ageH / 48);
  }
  return Math.round(100 * (1 - Math.exp(-sum / 3)));
}

export const disruptionLevel = (score: number): DisruptionLevel => (score >= 60 ? "high" : score >= 35 ? "elevated" : score >= 15 ? "watch" : "calm");

export const LEVEL_COLORS: Record<DisruptionLevel, string> = { calm: "#4caf7a", watch: "#e0b341", elevated: "#ff8a3d", high: "#ff3b4e" };

export interface ChokepointMonitor {
  generatedAt: string;
  days: number;
  chokepoints: ChokepointStatus[];
}

export function chokepointStatus(c: Chokepoint, events: ScoredEvent[], nowMs: number): ChokepointStatus {
  const byCategory: Partial<Record<EventCategory, number>> = {};
  for (const e of events) byCategory[e.type] = (byCategory[e.type] ?? 0) + 1;
  const score = disruptionScore(events, nowMs);
  const top = [...events].sort((a, b) => b.importanceScore - a.importanceScore || b.timestamp.localeCompare(a.timestamp)).slice(0, 5);
  return { id: c.id, name: c.name, lon: c.lon, lat: c.lat, radiusKm: c.radiusKm, connects: c.connects, total: events.length, byCategory, score, level: disruptionLevel(score), top };
}
