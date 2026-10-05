/**
 * Ingestion pipeline:
 *
 *   raw records ─ connector.parse ─▶ candidates
 *     ─▶ validate (zod)  ─▶ normalise  ─▶ geo-enrich (reverse geocode)
 *     ─▶ upsert by source record id  │  or deduplicate against nearby events  │  or create
 *     ─▶ score (importance/status/confidence)  ─▶ link related events  ─▶ store
 */
import "server-only";
import {
  EventCandidateSchema,
  type EventCandidate,
  type EventCandidateInput,
  type EventCategory,
  type WorldEvent,
} from "@/types/events";
import { createEvent, mergeCandidate, type GeoEnrichment } from "@/lib/events/build";
import { findBestMatch, ruleFor, type Comparable } from "@/lib/deduplication/similarity";
import { describeNearest, getCountry, reverseGeocode } from "@/lib/geo/gazetteer";
import { normalizeLon, oceanName } from "@/lib/geo/math";
import type { EventRepository } from "@/lib/db/types";

export interface IngestStats {
  received: number;
  created: number;
  updated: number;
  deduplicated: number;
  unchanged: number;
  invalid: number;
  errors: string[];
}

export function emptyStats(): IngestStats {
  return { received: 0, created: 0, updated: 0, deduplicated: 0, unchanged: 0, invalid: 0, errors: [] };
}

/** Pure-ish normalisation of a validated candidate. */
export function normalizeCandidate(c: EventCandidate): EventCandidate {
  const clean = (s: string | null) => (s ? s.replace(/\s+/g, " ").trim() || null : null);
  return {
    ...c,
    title: c.title.replace(/\s+/g, " ").trim(),
    summary: c.summary.replace(/\s+/g, " ").trim(),
    longitude: Math.round(normalizeLon(c.longitude) * 1e5) / 1e5,
    latitude: Math.round(c.latitude * 1e5) / 1e5,
    locationName: clean(c.locationName),
    city: clean(c.city),
    country: c.country ? c.country.toUpperCase() : null,
  };
}

/** Transcontinental countries: assign the macro region by longitude. */
export function regionFor(code: string | null, region: string | null, lon: number): string | null {
  if (code === "RU") return lon > 60 ? "Asia" : "Europe";
  if (code === "KZ") return "Asia";
  return region;
}

export function enrichGeo(c: EventCandidate): GeoEnrichment {
  let country = c.country ? getCountry(c.country) : undefined;
  if (!country) country = reverseGeocode(c.latitude, c.longitude).country ?? undefined;
  return {
    country: country?.code ?? c.country ?? null,
    countryName: country?.name ?? null,
    region: regionFor(country?.code ?? null, country?.region ?? null, c.longitude),
    fallbackLocationName: c.locationName
      ? null
      : (describeNearest(c.latitude, c.longitude) ?? country?.name ?? oceanName(c.latitude, c.longitude)),
  };
}

/**
 * Text used for semantic matching. For news-derived events the generated title
 * is mostly the place name (already handled by the geo signal), so we compare
 * the event label plus the article headlines instead — otherwise unrelated
 * incidents in the same city would merge.
 */
export function dedupText(e: { title: string; subtype: string | null; sources: Array<{ title: string | null; dataSourceId: string }> }): string {
  const headlines = e.sources.filter((s) => s.dataSourceId === "gdelt" && s.title).map((s) => s.title);
  if (!headlines.length) return e.title;
  return [e.subtype ?? "", ...headlines.slice(0, 5)].join(" ");
}

const toComparable = (e: WorldEvent): Comparable & { id: string } => ({
  id: e.id,
  type: e.type,
  subtype: e.subtype,
  title: dedupText(e),
  latitude: e.latitude,
  longitude: e.longitude,
  timestamp: e.timestamp,
  entities: e.entities,
  metrics: e.metrics,
  dataSourceIds: [...new Set(e.sources.map((s) => s.dataSourceId))],
});

/** Category pairs that are plausibly linked when close in space & time. */
const RELATED_PAIRS: Array<[EventCategory, EventCategory]> = [
  ["EARTHQUAKE", "WEATHER"], // tsunami bulletins
  ["EARTHQUAKE", "INFRASTRUCTURE"],
  ["EARTHQUAKE", "VOLCANO"],
  ["VOLCANO", "AVIATION"],
  ["WEATHER", "FLOOD"],
  ["WEATHER", "INFRASTRUCTURE"],
  ["FIRE", "WEATHER"],
  ["FIRE", "FIRE"],
  ["FLOOD", "DISASTER"],
  // News categories are deliberately not auto-linked: in dense cities proximity
  // alone produces mostly unrelated pairs. (Future: entity/semantic linking.)
];
const relatedSet = new Set(RELATED_PAIRS.flatMap(([a, b]) => [`${a}|${b}`, `${b}|${a}`]));

export async function ingestCandidates(
  repo: EventRepository,
  inputs: EventCandidateInput[],
  opts: { mergeWithinSource: ReadonlySet<string>; now?: number },
): Promise<IngestStats & { touched: WorldEvent[] }> {
  const now = opts.now ?? Date.now();
  const stats = emptyStats();
  const touched: WorldEvent[] = [];
  stats.received = inputs.length;

  for (const input of inputs) {
    const parsed = EventCandidateSchema.safeParse(input);
    if (!parsed.success) {
      stats.invalid++;
      if (stats.errors.length < 5) {
        stats.errors.push(`invalid candidate: ${parsed.error.issues.slice(0, 2).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
      }
      continue;
    }
    const c = normalizeCandidate(parsed.data);

    // 1. Same source record seen before → update in place.
    const existing = await repo.findBySourceRecord(c.source.id);
    if (existing) {
      const { event, changed } = mergeCandidate(existing, c, now);
      if (changed) {
        await repo.save(event);
        stats.updated++;
        touched.push(event);
      } else {
        stats.unchanged++;
      }
      continue;
    }

    // 1b. Record supersedes an earlier one (e.g. alert update) → replace that source in place.
    let superseded: WorldEvent | null = null;
    for (const old of c.supersedes) {
      superseded = await repo.findBySourceRecord(old);
      if (superseded) break;
    }
    if (superseded) {
      // Swap the superseded source record for the new one, then merge as an update.
      const replaced = new Set(c.supersedes);
      const firstIdx = superseded.sources.findIndex((s) => replaced.has(s.id));
      const sources = superseded.sources
        .map((s, i) => (i === firstIdx ? c.source : s))
        .filter((s) => !replaced.has(s.id));
      const { event, kind } = mergeCandidate({ ...superseded, sources }, c, now);
      if (kind === "unchanged") {
        event.timeline.push({ at: new Date(now).toISOString(), kind: "UPDATE", label: `${c.source.sourceName} issued an update`, sourceId: c.source.id });
        event.updatedAt = new Date(now).toISOString();
      }
      await repo.save(event);
      stats.updated++;
      touched.push(event);
      continue;
    }

    // 2. Deduplicate against nearby events of the same type.
    const rule = ruleFor(c.type);
    const t = Date.parse(c.timestamp);
    const pool = await repo.findNear({
      lat: c.latitude,
      lon: c.longitude,
      radiusKm: Math.max(rule.radiusKm, rule.strongTextRadiusKm ?? 0),
      fromMs: t - rule.windowMs,
      toMs: t + rule.windowMs,
      type: c.type,
    });
    const comparable: Comparable = {
      type: c.type,
      subtype: c.subtype,
      title: dedupText({ title: c.title, subtype: c.subtype, sources: [c.source] }),
      latitude: c.latitude,
      longitude: c.longitude,
      timestamp: c.timestamp,
      entities: c.entities,
      metrics: c.metrics,
      dataSourceIds: [c.source.dataSourceId],
    };
    const best = findBestMatch(comparable, pool.map(toComparable), { mergeWithinSource: opts.mergeWithinSource });
    if (best) {
      const target = pool.find((e) => e.id === best.match.id)!;
      const { event } = mergeCandidate(target, c, now);
      await repo.save(event);
      stats.deduplicated++;
      touched.push(event);
      continue;
    }

    // 3. New event.
    const event = createEvent(c, enrichGeo(c), now);
    await repo.save(event); // persist first: relationships reference it
    if (await linkRelated(repo, event, now)) await repo.save(event);
    stats.created++;
    touched.push(event);
  }
  return { ...stats, touched };
}

/** Rule-based relationship discovery for newly created events. Returns true if links were added. */
async function linkRelated(repo: EventRepository, event: WorldEvent, now: number): Promise<boolean> {
  const t = Date.parse(event.timestamp);
  const near = await repo.findNear({
    lat: event.latitude,
    lon: event.longitude,
    radiusKm: 300,
    fromMs: t - 48 * 3_600_000,
    toMs: t + 48 * 3_600_000,
  });
  const ownSources = new Set(event.sources.map((s) => s.dataSourceId));
  const candidates = near
    .filter((o) => o.id !== event.id && relatedSet.has(`${event.type}|${o.type}`))
    // Same-type links only across different feeds (e.g. EONET wildfire ↔ FIRMS detections)
    .filter((o) => o.type !== event.type || !o.sources.some((s) => ownSources.has(s.dataSourceId)))
    .slice(0, 8);
  for (const o of candidates) {
    await repo.addRelationship({
      fromEventId: event.id,
      toEventId: o.id,
      type: "POSSIBLY_RELATED",
      basis: `rule:proximity(${event.type}↔${o.type}, ≤300 km, ≤48 h)`,
      createdAt: new Date(now).toISOString(),
    });
    if (!event.relatedEventIds.includes(o.id)) event.relatedEventIds.push(o.id);
    if (!o.relatedEventIds.includes(event.id)) {
      await repo.save({ ...o, relatedEventIds: [...o.relatedEventIds, event.id] });
    }
  }
  return candidates.length > 0;
}
