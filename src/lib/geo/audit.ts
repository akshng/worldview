/**
 * Geographic QA: checks every event's coordinates against the gazetteer.
 * Exposed at GET /api/geo-audit (developer tooling) and used in tests.
 */
import "server-only";
import type { WorldEvent } from "@/types/events";
import { reverseGeocode } from "./gazetteer";

export interface GeoIssue {
  id: string;
  title: string;
  source: string;
  kind: "country-mismatch" | "null-island" | "no-country" | "stacked";
  detail: string;
  latitude: number;
  longitude: number;
}

export function auditGeography(events: WorldEvent[]) {
  const issues: GeoIssue[] = [];
  const bySource: Record<string, { events: number; mismatches: number; noCountry: number; precision: Record<string, number> }> = {};
  const stacks = new Map<string, WorldEvent[]>();
  for (const e of events) {
    const src = e.sources[0]?.dataSourceId ?? "unknown";
    const s = (bySource[src] ??= { events: 0, mismatches: 0, noCountry: 0, precision: {} });
    s.events++;
    s.precision[e.geoPrecision] = (s.precision[e.geoPrecision] ?? 0) + 1;
    const base = { id: e.id, title: e.title, source: src, latitude: e.latitude, longitude: e.longitude };
    if (Math.abs(e.latitude) < 0.01 && Math.abs(e.longitude) < 0.01) issues.push({ ...base, kind: "null-island", detail: "Coordinates are 0,0" });
    const inside = reverseGeocode(e.latitude, e.longitude, 0).country;
    if (!e.country) s.noCountry++;
    else if (inside && inside.code !== e.country) {
      s.mismatches++;
      issues.push({ ...base, kind: "country-mismatch", detail: `Event says ${e.country}, point lies in ${inside.code} (${inside.name})` });
    }
    const k = `${e.latitude.toFixed(3)},${e.longitude.toFixed(3)}`;
    stacks.set(k, [...(stacks.get(k) ?? []), e]);
  }
  const stacked = [...stacks.values()].filter((l) => l.length >= 3).sort((a, b) => b.length - a.length);
  for (const l of stacked.slice(0, 20)) {
    issues.push({ id: l[0].id, title: l[0].title, source: l[0].sources[0]?.dataSourceId ?? "unknown", latitude: l[0].latitude, longitude: l[0].longitude, kind: "stacked", detail: `${l.length} events share this exact point (${l[0].locationName ?? "?"})` });
  }
  return { checked: events.length, bySource, issues };
}
