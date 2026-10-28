/**
 * Server helpers that give the analyst the app's map data: places by name,
 * infrastructure near a point (OSM / WRI / NGA datasets bundled in public/geo/infra)
 * and live tracking (ships, aircraft, military aircraft, ISS, satellites, aurora).
 */
import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { CHOKEPOINTS } from "@/lib/infra/chokepoints";
import { searchPlacesLocal } from "@/lib/geo/place-index";

export interface Place {
  name: string;
  lat: number;
  lon: number;
  /** a sensible search radius for this kind of place */
  radiusKm: number;
}

const R = 6371;
export function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Point + radius → [west, south, east, north] (clamped; good enough away from the poles). */
export function bboxAround(lat: number, lon: number, radiusKm: number): [number, number, number, number] {
  const dLat = radiusKm / 111;
  const dLon = radiusKm / (111 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));
  return [Math.max(-180, lon - dLon), Math.max(-85, lat - dLat), Math.min(180, lon + dLon), Math.min(85, lat + dLat)];
}

/** Chokepoints first ("Hormuz", "Suez"), then the offline place index (countries, states, cities, airports). */
export function resolvePlace(name: string): Place | null {
  const q = name.trim().toLowerCase();
  if (!q) return null;
  const cp = CHOKEPOINTS.find((c) => c.name.toLowerCase().includes(q) || c.id.includes(q.replace(/\s+/g, "-")));
  if (cp) return { name: cp.name, lat: cp.lat, lon: cp.lon, radiusKm: cp.radiusKm };
  const hit = searchPlacesLocal(name, 1)[0];
  if (!hit) return null;
  const r = hit.kind === "country" || hit.kind === "continent" ? 900 : hit.kind === "state" ? 400 : 120;
  return { name: hit.detail ? `${hit.name} (${hit.detail})` : hit.name, lat: hit.lat, lon: hit.lon, radiusKm: r };
}

// ─── Infrastructure ─────────────────────────────────────────────────────────

export const INFRA_KINDS = {
  bases: { file: "bases", label: "military bases" },
  ports: { file: "ports", label: "ports" },
  power: { file: "power-plants", label: "power plants" },
  nuclear: { file: "power-plants", label: "nuclear power plants" },
  pipelines: { file: "pipelines", label: "oil & gas pipelines" },
  cables: { file: "cables", label: "undersea cables" },
  landing: { file: "landing-points", label: "cable landing points" },
  datacenters: { file: "datacenters", label: "data centers" },
  lng: { file: "lng", label: "LNG terminals" },
} as const;
export type InfraKind = keyof typeof INFRA_KINDS;

type Feature = { geometry: { type: string; coordinates: unknown }; properties: Record<string, unknown> };
const infraCache = new Map<string, Promise<Feature[]>>();
function loadInfra(file: string): Promise<Feature[]> {
  let p = infraCache.get(file);
  if (!p) {
    p = readFile(path.join(process.cwd(), "public", "geo", "infra", `${file}.geojson`), "utf8").then((s) => (JSON.parse(s) as { features: Feature[] }).features);
    infraCache.set(file, p);
  }
  return p;
}

/** Nearest point of a geometry (lines: closest vertex). */
function nearest(g: Feature["geometry"], lat: number, lon: number): number {
  const pts: number[][] =
    g.type === "Point" ? [g.coordinates as number[]] : g.type === "LineString" ? (g.coordinates as number[][]) : g.type === "MultiLineString" ? (g.coordinates as number[][][]).flat() : [];
  let best = Infinity;
  for (const p of pts) best = Math.min(best, distanceKm(lat, lon, p[1], p[0]));
  return best;
}

export async function infraNear(lat: number, lon: number, radiusKm: number, kinds: InfraKind[]) {
  const out: Record<string, { total: number; nearest: Array<{ name: string; km: number; detail?: string }> }> = {};
  for (const k of kinds) {
    const feats = await loadInfra(INFRA_KINDS[k].file);
    const hits = feats
      .filter((f) => k !== "nuclear" || String(f.properties.f ?? "").toLowerCase() === "nuclear")
      .map((f) => ({ f, km: nearest(f.geometry, lat, lon) }))
      .filter((x) => x.km <= radiusKm)
      .sort((a, b) => a.km - b.km);
    out[INFRA_KINDS[k].label] = {
      total: hits.length,
      nearest: hits.slice(0, 6).map(({ f, km }) => {
        const p = f.properties;
        const detail = [p.f && `${p.f}`, p.mw && `${p.mw} MW`, p.op && `operator ${p.op}`, p.km && `${p.km} km long`, p.c && `${p.c}`].filter(Boolean).join(", ");
        return { name: String(p.n ?? "unnamed"), km: Math.round(km), ...(detail ? { detail } : {}) };
      }),
    };
  }
  return out;
}

// ─── Live tracking ──────────────────────────────────────────────────────────

export const TRACK_KINDS = ["ships", "aircraft", "military_aircraft", "iss", "satellites", "aurora"] as const;
export type TrackKind = (typeof TRACK_KINDS)[number];

/** AIS ship-type code → category. */
export function shipCategory(code: unknown): string {
  const n = Number(code);
  if (!Number.isFinite(n) || n <= 0) return "unknown";
  if (n >= 80 && n <= 89) return "tanker";
  if (n >= 70 && n <= 79) return "cargo";
  if (n >= 60 && n <= 69) return "passenger";
  if (n === 30) return "fishing";
  if (n === 35) return "military";
  if (n === 31 || n === 32 || n === 52) return "tug/towing";
  if (n === 36 || n === 37) return "pleasure/sailing";
  if (n >= 40 && n <= 49) return "high-speed craft";
  if (n === 51 || n === 55) return "search & rescue / law enforcement";
  return "other";
}

const rowObj = (fields: string[], row: unknown[]) => Object.fromEntries(fields.map((f, i) => [f, row[i]]));

export async function tracking(kind: TrackKind, place: Place | null) {
  const bbox = place ? bboxAround(place.lat, place.lon, place.radiusKm) : null;
  const inside = (lat: number, lon: number) => !place || distanceKm(place.lat, place.lon, lat, lon) <= place.radiusKm;
  switch (kind) {
    case "ships": {
      if (!bbox) throw new Error("Ships need a place (e.g. 'Strait of Hormuz').");
      const { viewportShips } = await import("@/layers/maritime/viewport");
      const v = await viewportShips(bbox);
      const rows = v.data.rows.map((r) => rowObj(v.data.fields, r as unknown[])).filter((r) => inside(Number(r.lat), Number(r.lon)));
      const byType = new Map<string, number>();
      for (const r of rows) byType.set(shipCategory(r.ship_type), (byType.get(shipCategory(r.ship_type)) ?? 0) + 1);
      const sample = rows.slice(0, 8).map((r) => ({ name: r.name, type: shipCategory(r.ship_type), speedKn: r.sog_kn, destination: r.destination }));
      return { area: place!.name, radiusKm: place!.radiusKm, vessels: rows.length, byType: Object.fromEntries([...byType].sort((a, b) => b[1] - a[1]).slice(0, 8)), sample, coverageNote: v.truncated ? "only the busiest part of the area was loaded" : undefined, observedAt: v.observedAt };
    }
    case "aircraft": {
      if (!bbox) throw new Error("Aircraft need a place.");
      const { viewportAircraft } = await import("@/layers/aircraft");
      const v = await viewportAircraft(bbox);
      const rows = v.data.rows.map((r) => rowObj(v.data.fields, r as unknown[])).filter((r) => inside(Number(r.lat), Number(r.lon)));
      return { area: place!.name, radiusKm: place!.radiusKm, aircraft: rows.length, military: rows.filter((r) => r.military).length, emergencies: rows.filter((r) => ["7500", "7600", "7700"].includes(String(r.squawk))).map((r) => ({ callsign: r.callsign, squawk: r.squawk })), sample: rows.slice(0, 8), observedAt: v.observedAt };
    }
    case "military_aircraft": {
      const { getLayer } = await import("@/layers/registry");
      const { snapshot } = await getLayer("military-aircraft");
      const d = snapshot.data as { fields: string[]; rows: unknown[][] };
      const rows = d.rows.map((r) => rowObj(d.fields, r)).filter((r) => inside(Number(r.lat), Number(r.lon)));
      const types = new Map<string, number>();
      for (const r of rows) types.set(String(r.type || "unknown"), (types.get(String(r.type || "unknown")) ?? 0) + 1);
      return { area: place?.name ?? "worldwide", aircraft: rows.length, byType: Object.fromEntries([...types].sort((a, b) => b[1] - a[1]).slice(0, 10)), sample: rows.slice(0, 10), observedAt: snapshot.observedAt };
    }
    case "iss": {
      const { getLayer } = await import("@/layers/registry");
      const { snapshot } = await getLayer("iss");
      const p = (snapshot.data as { position: { lat: number; lon: number; altKm: number; speedKmh: number; visibility: string } }).position;
      const { reverseGeocode } = await import("@/lib/geo/gazetteer");
      const over = reverseGeocode(p.lat, p.lon);
      return { lat: p.lat, lon: p.lon, over, altitudeKm: Math.round(p.altKm), speedKmh: Math.round(p.speedKmh), sunlit: p.visibility === "daylight", observedAt: snapshot.observedAt };
    }
    case "satellites": {
      const { getLayer } = await import("@/layers/registry");
      const { snapshot } = await getLayer("satellites");
      const d = snapshot.data as { groups: Record<string, number> };
      return { tracked: snapshot.count, byGroup: d.groups, note: "Orbital elements (TLEs); positions are propagated on the map.", observedAt: snapshot.observedAt };
    }
    case "aurora": {
      const { getLayer } = await import("@/layers/registry");
      const { snapshot } = await getLayer("aurora");
      const d = snapshot.data as { maxProbability: number; forecastTime: string | null; cells: Array<[number, number, number]> };
      const strong = d.cells.filter((c) => c[2] >= 50);
      const north = strong.filter((c) => c[1] > 0);
      return {
        maxProbability: d.maxProbability,
        forecastTime: d.forecastTime,
        areasAbove50pct: strong.length,
        southernmostNorthernLat: north.length ? Math.min(...north.map((c) => c[1])) : null,
        note: "Aurora probability (NOAA OVATION). The lower the latitude reached, the further south it may be visible.",
        observedAt: snapshot.observedAt,
      };
    }
  }
}
