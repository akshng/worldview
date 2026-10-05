/**
 * Aggregations computed from the event store: global stats, country overviews,
 * related events. All numbers come from stored events — nothing is estimated.
 */
import "server-only";
import { toEventSummary, type EventSummary, type WorldEvent } from "@/types/events";
import type { EventRepository } from "@/lib/db/types";
import { haversineKm } from "@/lib/geo/math";
import { getCountry } from "@/lib/geo/gazetteer";
import { sortEvents } from "@/lib/events/query";

export async function countryOverview(repo: EventRepository, code: string, now = Date.now()) {
  const country = getCountry(code);
  const all = await repo.scan({ country: code.toUpperCase() });
  const last24 = all.filter((e) => now - Date.parse(e.timestamp) <= 86_400_000);
  const byCategory24h: Record<string, number> = {};
  for (const e of last24) byCategory24h[e.type] = (byCategory24h[e.type] ?? 0) + 1;
  const top = sortEvents([...all], "importance", now).slice(0, 25).map(toEventSummary);
  const recent = sortEvents([...all], "recent", now).slice(0, 25).map(toEventSummary);
  return {
    country: country
      ? {
          code: country.code,
          name: country.name,
          nameLong: country.nameLong,
          region: country.region,
          subregion: country.subregion,
          population: country.population,
          bbox: country.bbox,
          label: country.label,
        }
      : { code: code.toUpperCase(), name: code.toUpperCase(), nameLong: null, region: null, subregion: null, population: null, bbox: null, label: null },
    totalEvents: all.length,
    highImportance: all.filter((e) => e.importanceScore > 60).length,
    last24h: last24.length,
    byCategory24h,
    topEvents: top,
    recentEvents: recent,
  };
}

export interface RelatedEvent {
  event: EventSummary;
  relation: string;
  basis: string;
}

export async function relatedEvents(repo: EventRepository, e: WorldEvent): Promise<RelatedEvent[]> {
  const out: RelatedEvent[] = [];
  const seen = new Set<string>([e.id]);
  const rels = await repo.relationshipsFor(e.id);
  const linkedIds = rels.map((r) => (r.fromEventId === e.id ? r.toEventId : r.fromEventId));
  const linked = await repo.getMany([...new Set([...linkedIds, ...e.relatedEventIds])]);
  for (const o of linked) {
    if (seen.has(o.id)) continue;
    seen.add(o.id);
    const r = rels.find((x) => x.fromEventId === o.id || x.toEventId === o.id);
    out.push({ event: toEventSummary(o), relation: r?.type ?? "POSSIBLY_RELATED", basis: r?.basis ?? "linked" });
  }
  // Nearby recent events (heuristic, clearly labelled as proximity only)
  const t = Date.parse(e.timestamp);
  const near = await repo.findNear({ lat: e.latitude, lon: e.longitude, radiusKm: 250, fromMs: t - 36 * 3_600_000, toMs: t + 36 * 3_600_000 });
  near
    .filter((o) => !seen.has(o.id))
    .sort((a, b) => b.importanceScore - a.importanceScore)
    .slice(0, 6)
    .forEach((o) => {
      seen.add(o.id);
      const km = Math.round(haversineKm(e.latitude, e.longitude, o.latitude, o.longitude));
      out.push({ event: toEventSummary(o), relation: "NEARBY", basis: `${km} km away, within 36 h (proximity only)` });
    });
  return out.slice(0, 12);
}
