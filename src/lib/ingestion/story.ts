/**
 * Matching helpers shared by the ingestion pipeline and the store migration:
 * warning series (seriesKey) and cross-source news stories (same headline).
 */
import type { EventCandidate, WorldEvent } from "@/types/events";
import { headlineSimilarity, tokenize } from "@/lib/deduplication/similarity";
import { haversineKm } from "@/lib/geo/math";

/** Gap allowed between consecutive records of one warning series (seriesKey). */
export const SERIES_GAP_MS = 12 * 3_600_000;
export const SERIES_LOOKBACK_MS = 14 * 24 * 3_600_000;

/** Do the periods [start, end] of an event and a candidate overlap or nearly touch? */
export function seriesTouch(a: { timestamp: string; resolvedAt: string | null }, b: { timestamp: string; resolvedAt: string | null }, gapMs = SERIES_GAP_MS): boolean {
  const as = Date.parse(a.timestamp), ae = Date.parse(a.resolvedAt ?? a.timestamp);
  const bs = Date.parse(b.timestamp), be = Date.parse(b.resolvedAt ?? b.timestamp);
  return bs <= ae + gapMs && be >= as - gapMs;
}

/** Lower-cased, accent- and punctuation-free headline for exact story matching. */
export function normalizeHeadline(t: string): string {
  return t
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export const NEWS_SOURCE_TYPES: ReadonlySet<string> = new Set(["NEWS_MEDIA", "NEWS_AGGREGATOR"]);
/** Same story across outlets/feeds: published within this window of the event. */
export const STORY_WINDOW_MS = 36 * 3_600_000;
/** Without a shared country, syndicated copies must still be geocoded within this distance. */
export const STORY_RADIUS_KM = 800;
/** Same-country search radius (covers large countries). */
export const STORY_COUNTRY_RADIUS_KM = 3000;
export const STORY_MIN_SIMILARITY = 0.8;

/**
 * Cross-source story match: an identical (normalised) or near-identical headline
 * (≥ 0.8 similarity, ≥ 5 meaningful words) about the same country — or nearby when a
 * country is unknown — within 36 h, regardless of how each feed categorised it.
 */
export function findStoryMatch(
  c: Pick<EventCandidate, "title" | "latitude" | "longitude" | "timestamp" | "source">,
  country: string | null,
  pool: WorldEvent[],
): WorldEvent | null {
  if (!NEWS_SOURCE_TYPES.has(c.source.sourceType)) return null;
  const head = normalizeHeadline(c.source.title ?? c.title);
  const tokens = tokenize(head);
  if (tokens.size < 4) return null;
  const t = Date.parse(c.timestamp);
  let best: { e: WorldEvent; sim: number } | null = null;
  for (const e of pool) {
    if (Math.abs(Date.parse(e.timestamp) - t) > STORY_WINDOW_MS) continue;
    if (!e.sources.some((s) => NEWS_SOURCE_TYPES.has(s.sourceType))) continue;
    if (country && e.country) {
      if (country !== e.country) continue;
    } else if (haversineKm(c.latitude, c.longitude, e.latitude, e.longitude) > STORY_RADIUS_KM) continue;
    // Headlines only: generated titles ("Armed clash — Tehran, Iran") are not stories.
    for (const h of new Set(e.sources.map((s) => s.title))) {
      if (!h) continue;
      const n = normalizeHeadline(h);
      let sim = n === head ? 1 : 0;
      if (!sim) {
        const other = tokenize(n);
        if (Math.min(other.size, tokens.size) >= 5) sim = headlineSimilarity(tokens, other);
      }
      if (sim >= STORY_MIN_SIMILARITY && (!best || sim > best.sim)) best = { e, sim };
    }
  }
  return best?.e ?? null;
}

