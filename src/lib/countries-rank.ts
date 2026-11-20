/**
 * Countries page ranking (pure, client-safe).
 *
 * Events carry only an ISO-3166 alpha-2 `country` code, so activity can only be counted per code.
 * Natural Earth has a few territories that share their sovereign's code (Australia, "Indian Ocean
 * Ter." and "Ashmore and Cartier Is." are all AU); listing them separately would repeat the
 * sovereign's count, so they are merged into the first (sovereign) entry for that code.
 */
import type { EventSummary } from "@/types/events";

export type CountryListItem = { code: string; name: string; continent: string; subregion: string; population: number };
export type RankedCountry = CountryListItem & { n: number; top: number };

/** One entry per ISO2 code, keeping the first (sovereign) entry — same rule as `getCountry`. */
export function dedupeByCode<T extends { code: string }>(list: readonly T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const c of list) {
    if (seen.has(c.code)) continue;
    seen.add(c.code);
    out.push(c);
  }
  return out;
}

/** Event count and the highest importance score per country code over the last `windowMs`. */
export function countryActivity(
  events: readonly Pick<EventSummary, "country" | "timestamp" | "importanceScore">[],
  now: number,
  windowMs = 86_400_000,
): Map<string, { n: number; top: number }> {
  const since = now - windowMs;
  const m = new Map<string, { n: number; top: number }>();
  for (const e of events) {
    if (!e.country || Date.parse(e.timestamp) < since) continue;
    const a = m.get(e.country) ?? { n: 0, top: 0 };
    a.n++;
    a.top = Math.max(a.top, e.importanceScore);
    m.set(e.country, a);
  }
  return m;
}

/**
 * Filter by the search text and rank. Without a search: most events in the window first, then the
 * most important single event, then name. With a search: alphabetical.
 */
export function rankCountries(list: readonly CountryListItem[], activity: Map<string, { n: number; top: number }>, query = ""): RankedCountry[] {
  const needle = query.trim().toLowerCase();
  return dedupeByCode(list)
    .filter((c) => !needle || c.name.toLowerCase().includes(needle) || c.code.toLowerCase() === needle || c.subregion.toLowerCase().includes(needle))
    .map((c) => ({ ...c, ...(activity.get(c.code) ?? { n: 0, top: 0 }) }))
    .sort((a, b) => (needle ? a.name.localeCompare(b.name) : b.n - a.n || b.top - a.top || a.name.localeCompare(b.name)));
}
