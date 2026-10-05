/**
 * Pure aggregate statistics over events. Used by /api/stats and by the client
 * (on events fetched from the API), so both always agree.
 */
import { HAZARD_CATEGORIES } from "@/lib/categories";
import type { EventSummary } from "@/types/events";

type StatInput = Pick<EventSummary, "type" | "country" | "timestamp" | "importanceScore" | "status">;

export interface EventStats {
  totalEvents: number;
  lastHour: number;
  highImportance: number;
  countriesAffected: number;
  activeDisasters: number;
  byCategory: Record<string, number>;
}

const hazard = new Set<string>(HAZARD_CATEGORIES);

export function computeStats(events: StatInput[], now = Date.now()): EventStats {
  const byCategory: Record<string, number> = {};
  const countries = new Set<string>();
  let lastHour = 0, high = 0, disasters = 0;
  for (const e of events) {
    byCategory[e.type] = (byCategory[e.type] ?? 0) + 1;
    if (e.country) countries.add(e.country);
    const t = Date.parse(e.timestamp);
    if (t <= now && now - t <= 3_600_000) lastHour++;
    if (e.importanceScore > 60) high++;
    if (hazard.has(e.type) && e.status !== "RESOLVED") disasters++;
  }
  return {
    totalEvents: events.length,
    lastHour,
    highImportance: high,
    countriesAffected: countries.size,
    activeDisasters: disasters,
    byCategory,
  };
}
