/**
 * Series keys for warning feeds that reissue the same warning as new records
 * (see EventCandidate.seriesKey). Kept here so connectors and the store migration
 * derive identical keys.
 */
import type { WorldEvent } from "@/types/events";

/** NWS: same warning type, same polygon (representative point to 0.01°). */
export const nwsSeriesKey = (event: string, lat: number, lon: number) => `nws:${event.toLowerCase()}@${lat.toFixed(2)},${lon.toFixed(2)}`;

/** MeteoAlarm: same country, hazard type, awareness level and areas (time slices / language variants). */
export function meteoAlarmSeriesKey(iso2: string, typeParam: string, levelParam: string, areas: string[]): string {
  return `meteoalarm:${iso2.toUpperCase()}:${typeParam.split(";")[0].trim()}:${levelParam.split(";")[0].trim()}:${[...areas].sort().join("|").toLowerCase()}`;
}

/** Series key for events stored before series keys existed. */
export function legacySeriesKey(e: WorldEvent): string | null {
  if (e.seriesKey) return e.seriesKey;
  const feed = e.sources[0]?.dataSourceId;
  if (feed === "nws" && typeof e.metrics.event_name === "string") return nwsSeriesKey(e.metrics.event_name, e.latitude, e.longitude);
  if (feed === "meteoalarm" && e.country) {
    const raw = e.rawData[e.sources[0].id] as { type?: string; level?: string; areas?: string[] } | undefined;
    if (raw?.type && raw.level && Array.isArray(raw.areas)) return meteoAlarmSeriesKey(e.country, raw.type, raw.level, raw.areas);
  }
  return null;
}
