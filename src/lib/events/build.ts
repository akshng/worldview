/**
 * Pure functions that turn candidates into WorldEvents and merge further
 * candidates (from the same or other sources) into existing events.
 */
import type { EventCandidate, TimelineEntry, WorldEvent } from "@/types/events";
import { calculateImportance } from "@/lib/scoring/importance";
import { deriveConfidence, deriveStatus, independentPublisherCount, publisherKey } from "./status";
import { authorityOf, sourceKeys, trimEvent, wasSeen } from "./compact";

export { authorityOf };

export interface GeoEnrichment {
  country: string | null;
  countryName: string | null;
  region: string | null;
  /** Used when the candidate has no location name of its own */
  fallbackLocationName: string | null;
  /** Explanation when the pipeline refined the location */
  note?: { method: string; detail: string } | null;
}

let counter = 0;
export function newEventId(now = Date.now()): string {
  counter = (counter + 1) % 1_000_000;
  return `evt_${now.toString(36)}${counter.toString(36).padStart(4, "0")}${Math.random().toString(36).slice(2, 6)}`;
}

export function createEvent(c: EventCandidate, geo: GeoEnrichment, now = Date.now(), id = newEventId(now)): WorldEvent {
  const nowIso = new Date(now).toISOString();
  const timeline: TimelineEntry[] = [
    {
      at: c.source.publishedAt ?? c.timestamp,
      kind: c.source.assertion === "OFFICIAL_FINAL" ? "OFFICIAL_CONFIRMATION" : "INITIAL_REPORT",
      label: `${c.source.assertion === "OFFICIAL_FINAL" ? "Confirmed by" : "First reported by"} ${c.source.sourceName}`,
      sourceId: c.source.id,
    },
  ];
  if (c.resolvedAt && Date.parse(c.resolvedAt) <= now) {
    timeline.push({ at: c.resolvedAt, kind: "RESOLVED", label: `Marked ended by ${c.source.sourceName}`, sourceId: c.source.id });
  }
  const event: WorldEvent = {
    id,
    type: c.type,
    subtype: c.subtype,
    title: c.title,
    summary: c.summary,
    description: c.description,
    latitude: c.latitude,
    longitude: c.longitude,
    geoPrecision: c.geoPrecision,
    geometry: c.geometry ?? null,
    geoNote: geo.note ?? null,
    locationName: c.locationName ?? geo.fallbackLocationName,
    country: c.country ?? geo.country,
    countryName: geo.countryName,
    region: geo.region,
    city: c.city,
    timestamp: c.timestamp,
    resolvedAt: c.resolvedAt,
    createdAt: nowIso,
    updatedAt: nowIso,
    importanceScore: 0,
    importanceFactors: [],
    confidenceScore: 0,
    sourceCount: 1,
    sources: [c.source],
    entities: dedupeEntities(c.entities),
    relatedEventIds: [],
    status: "UNVERIFIED",
    metrics: { ...c.metrics },
    timeline,
    aiInterpretation: null,
    isSynthetic: c.isSynthetic,
    rawData: c.rawData === undefined ? {} : { [c.source.id]: c.rawData },
    lastEvidenceAt: nowIso,
    seriesKey: c.seriesKey ?? null,
  };
  return recompute(event, now);
}

/**
 * Merge a candidate into an existing event. Handles both updates of a source
 * already attached (same source id) and corroboration by a new source.
 */
export function mergeCandidate(event: WorldEvent, c: EventCandidate, now = Date.now()): { event: WorldEvent; changed: boolean; kind: "updated" | "corroborated" | "unchanged" } {
  const nowIso = new Date(now).toISOString();
  const idx = event.sources.findIndex((s) => s.id === c.source.id);
  const next: WorldEvent = {
    ...event,
    sources: [...event.sources],
    timeline: [...event.timeline],
    metrics: { ...event.metrics },
    rawData: { ...event.rawData },
  };
  let kind: "updated" | "corroborated" | "unchanged" = "unchanged";

  const primary = event.sources[0];
  const incomingIsPrimary =
    idx === 0 ||
    !primary ||
    authorityOf(c.source) > authorityOf(primary) ||
    // A published headline beats a title derived from a URL slug.
    (authorityOf(c.source) === authorityOf(primary) && primary.titleIsDerived && !c.source.titleIsDerived && !!c.source.title);

  if (idx >= 0) {
    const prev = event.sources[idx];
    next.sources[idx] = c.source;
    const materiallyChanged =
      idx === 0 &&
      (c.title !== event.title ||
        c.timestamp !== event.timestamp ||
        JSON.stringify(c.metrics) !== JSON.stringify(pick(event.metrics, Object.keys(c.metrics))) ||
        c.resolvedAt !== event.resolvedAt);
    if (prev.assertion !== "OFFICIAL_FINAL" && c.source.assertion === "OFFICIAL_FINAL") {
      next.timeline.push({ at: nowIso, kind: "OFFICIAL_CONFIRMATION", label: `Reviewed/confirmed by ${c.source.sourceName}`, sourceId: c.source.id });
      kind = "updated";
    } else if (materiallyChanged) {
      next.timeline.push({ at: nowIso, kind: "UPDATE", label: describeUpdate(event, c), sourceId: c.source.id });
      kind = "updated";
    }
  } else if ((c.source.sourceUrl && event.sources.some((s) => s.sourceUrl === c.source.sourceUrl)) || wasSeen(event, c.source)) {
    // Same article/record already attached under another id, or attached before and trimmed — nothing new.
    return { event, changed: false, kind: "unchanged" };
  } else {
    next.sources.push(c.source);
    next.entities = dedupeEntities([...event.entities, ...c.entities]);
    next.timeline.push({
      at: c.source.publishedAt ?? nowIso,
      kind: c.source.assertion === "OFFICIAL_FINAL" ? "OFFICIAL_CONFIRMATION" : "SOURCE_ADDED",
      label: `Also reported by ${c.source.sourceName}`,
      sourceId: c.source.id,
    });
    kind = "corroborated";
  }

  if (incomingIsPrimary) {
    next.type = c.type;
    next.subtype = c.subtype;
    next.title = c.title;
    next.summary = c.summary;
    next.description = c.description ?? event.description;
    next.latitude = c.latitude;
    next.longitude = c.longitude;
    next.geoPrecision = c.geoPrecision;
    if (c.geometry) next.geometry = c.geometry;
    next.locationName = c.locationName ?? event.locationName;
    next.timestamp = c.timestamp;
    next.metrics = { ...event.metrics, ...c.metrics };
    if (c.resolvedAt !== undefined) next.resolvedAt = c.resolvedAt;
    // keep the authoritative source first
    const i = next.sources.findIndex((s) => s.id === c.source.id);
    if (i > 0) next.sources.unshift(next.sources.splice(i, 1)[0]);
  } else {
    // Fill gaps only
    for (const [k, v] of Object.entries(c.metrics)) if (!(k in next.metrics)) next.metrics[k] = v;
  }

  if (next.resolvedAt && Date.parse(next.resolvedAt) <= now && !event.timeline.some((t) => t.kind === "RESOLVED")) {
    next.timeline.push({ at: next.resolvedAt, kind: "RESOLVED", label: `Marked ended by ${c.source.sourceName}`, sourceId: c.source.id });
    kind = kind === "unchanged" ? "updated" : kind;
  }

  if (c.rawData !== undefined) next.rawData[c.source.id] = c.rawData;
  if (kind !== "unchanged") next.updatedAt = nowIso;
  // Retention follows distinct new evidence: a material update/confirmation or a new outlet —
  // not another copy of the story from an outlet already counted.
  if (kind === "updated" || (kind === "corroborated" && isNewPublisher(event, c))) next.lastEvidenceAt = nowIso;
  next.timeline.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  return { event: recompute(next, now), changed: kind !== "unchanged", kind };
}

function isNewPublisher(event: WorldEvent, c: EventCandidate): boolean {
  const k = publisherKey(c.source);
  return !(event.publisherKeys ?? []).includes(k) && !event.sources.some((s) => publisherKey(s) === k);
}

/**
 * Merge another stored event (a duplicate) into `target`: sources, timeline, entities,
 * counts and seen keys are combined; the more authoritative primary wins.
 */
export function absorbEvent(target: WorldEvent, other: WorldEvent, now = Date.now()): WorldEvent {
  const [a, b] = authorityOf(other.sources[0] ?? target.sources[0]) > authorityOf(target.sources[0] ?? other.sources[0]) ? [other, target] : [target, other];
  const ids = new Set(a.sources.map((s) => s.id));
  const urls = new Set(a.sources.map((s) => s.sourceUrl).filter(Boolean));
  const extra = b.sources.filter((s) => !ids.has(s.id) && !(s.sourceUrl && urls.has(s.sourceUrl)));
  const merged: WorldEvent = {
    ...a,
    id: target.id,
    createdAt: target.createdAt < other.createdAt ? target.createdAt : other.createdAt,
    updatedAt: target.updatedAt > other.updatedAt ? target.updatedAt : other.updatedAt,
    lastEvidenceAt: [target.lastEvidenceAt ?? target.updatedAt, other.lastEvidenceAt ?? other.updatedAt].sort().at(-1),
    sources: [...a.sources, ...extra],
    timeline: [...a.timeline, ...b.timeline.filter((t) => !t.sourceId || !ids.has(t.sourceId))].sort((x, y) => Date.parse(x.at) - Date.parse(y.at)),
    entities: dedupeEntities([...a.entities, ...b.entities]),
    relatedEventIds: [...new Set([...a.relatedEventIds, ...b.relatedEventIds])].filter((id) => id !== target.id && id !== other.id),
    metrics: { ...b.metrics, ...a.metrics },
    rawData: { ...b.rawData, ...a.rawData },
    outletCount: Math.max(a.outletCount ?? 0, b.outletCount ?? 0),
    publisherKeys: [...new Set([...(a.publisherKeys ?? []), ...(b.publisherKeys ?? [])])],
    seenSourceKeys: [...new Set([...(a.seenSourceKeys ?? []), ...(b.seenSourceKeys ?? [])])],
    sourcesOmitted: (a.sourcesOmitted ?? 0) + (b.sourcesOmitted ?? 0),
    timelineOmitted: (a.timelineOmitted ?? 0) + (b.timelineOmitted ?? 0),
    seriesKey: a.seriesKey ?? b.seriesKey ?? null,
    aiInterpretation: a.aiInterpretation ?? b.aiInterpretation,
  };
  return recompute(merged, now);
}

/**
 * Merge a record of the same warning series (seriesKey): the event spans the union of
 * the periods; the newest record of that feed becomes the listed source and earlier
 * slices are counted (sourcesOmitted) and remembered, so re-polls of them change nothing.
 */
export function mergeSeries(event: WorldEvent, c: EventCandidate, now = Date.now()): { event: WorldEvent; changed: boolean } {
  const nowIso = new Date(now).toISOString();
  const known = event.sources.some((s) => s.id === c.source.id) || wasSeen(event, c.source);
  const start = c.timestamp < event.timestamp ? c.timestamp : event.timestamp;
  const end = event.resolvedAt && c.resolvedAt ? (c.resolvedAt > event.resolvedAt ? c.resolvedAt : event.resolvedAt) : (event.resolvedAt ?? c.resolvedAt);
  if (known && start === event.timestamp && end === event.resolvedAt) return { event, changed: false };
  const next: WorldEvent = { ...event, sources: [...event.sources], timeline: [...event.timeline], metrics: { ...event.metrics }, rawData: { ...event.rawData } };
  const extended = end !== event.resolvedAt;
  if (!known) {
    const replaced = next.sources.filter((s) => s.dataSourceId === c.source.dataSourceId);
    const others = next.sources.filter((s) => s.dataSourceId !== c.source.dataSourceId);
    next.sources = others.length && authorityOf(others[0]) > authorityOf(c.source) ? [others[0], c.source, ...others.slice(1)] : [c.source, ...others];
    for (const s of replaced) delete next.rawData[s.id];
    next.sourcesOmitted = (event.sourcesOmitted ?? 0) + replaced.length;
    next.seenSourceKeys = [...new Set([...(event.seenSourceKeys ?? []), ...replaced.flatMap(sourceKeys)])];
    if (c.rawData !== undefined) next.rawData[c.source.id] = c.rawData;
    // Text comes from the record with the latest end (its "valid until" matches the event).
    if (!event.resolvedAt || !c.resolvedAt || c.resolvedAt >= event.resolvedAt) {
      next.title = c.title;
      next.summary = c.summary;
      next.description = c.description ?? event.description;
      if (c.geometry) next.geometry = c.geometry;
      next.metrics = { ...event.metrics, ...c.metrics };
    }
    next.timeline.push({ at: c.source.publishedAt ?? nowIso, kind: "UPDATE", label: `${c.source.sourceName}: warning ${extended ? "extended" : "reissued"}`, sourceId: c.source.id });
  } else if (extended) {
    next.timeline.push({ at: nowIso, kind: "UPDATE", label: `${c.source.sourceName}: warning period extended`, sourceId: c.source.id });
  }
  next.timestamp = start;
  next.resolvedAt = end;
  if (next.resolvedAt && Date.parse(next.resolvedAt) > now) next.timeline = next.timeline.filter((t) => t.kind !== "RESOLVED");
  else if (next.resolvedAt && !next.timeline.some((t) => t.kind === "RESOLVED")) next.timeline.push({ at: next.resolvedAt, kind: "RESOLVED", label: `Marked ended by ${c.source.sourceName}`, sourceId: c.source.id });
  next.updatedAt = nowIso;
  next.lastEvidenceAt = nowIso;
  next.timeline.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  return { event: recompute(next, now), changed: true };
}

/** Recompute derived fields: status, confidence, source count, outlet count, importance. Applies the store caps. */
export function recompute(input: WorldEvent, now = Date.now()): WorldEvent {
  const e = trimEvent(input);
  const status = deriveStatus(e.sources, e.resolvedAt, now);
  const independentSources = Math.max(e.outletCount ?? 0, independentPublisherCount(e.sources));
  const { score, factors } = calculateImportance(
    {
      type: e.type,
      subtype: e.subtype,
      metrics: e.metrics,
      independentSources,
      officialFinal: e.sources.some((s) => s.assertion === "OFFICIAL_FINAL"),
      status,
      timestamp: e.timestamp,
      isSynthetic: e.isSynthetic,
    },
    now,
  );
  return {
    ...e,
    status,
    sourceCount: e.sources.length + (e.sourcesOmitted ?? 0),
    confidenceScore: deriveConfidence(e.sources, e.geoPrecision),
    importanceScore: score,
    importanceFactors: factors,
  };
}

function dedupeEntities<T extends { type: string; name: string; code: string | null }>(list: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const e of list) {
    const k = `${e.type}:${(e.code ?? e.name).toLowerCase()}`;
    if (!seen.has(k)) {
      seen.add(k);
      out.push(e);
    }
  }
  return out.slice(0, 40);
}

function pick<T extends Record<string, unknown>>(o: T, keys: string[]): Record<string, unknown> {
  const r: Record<string, unknown> = {};
  for (const k of keys) if (k in o) r[k] = o[k];
  return r;
}

function describeUpdate(prev: WorldEvent, c: EventCandidate): string {
  const parts: string[] = [];
  const pm = prev.metrics.magnitude, cm = c.metrics.magnitude;
  if (typeof pm === "number" && typeof cm === "number" && pm !== cm) parts.push(`magnitude revised ${pm} → ${cm}`);
  if (c.title !== prev.title && !parts.length) parts.push("details updated");
  if (c.resolvedAt && c.resolvedAt !== prev.resolvedAt) parts.push("end time set");
  return `${c.source.sourceName}: ${parts.join(", ") || "record updated"}`;
}
