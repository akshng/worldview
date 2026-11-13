/**
 * Compact on-disk form of events for the JSON snapshot (memory repository).
 *
 * Lossless: only values that can be derived exactly are left out and restored on
 * load — nulls of nullable fields, scores (recomputed on load), a source's
 * `dataSourceId`/`externalId` when its id is `${dataSourceId}:${externalId}`, a
 * source title equal to the event title, `titleIsDerived: false`, `credibility: null`,
 * timestamps equal to `updatedAt`, a timeline that is just the initial entry,
 * timeline entries that are the standard "reported by <source>" line for a listed
 * source (stored as e.g. "A3"), and the event title inside its summary.
 */
import { ENTITY_TYPES, type Entity, type EventSource, type TimelineEntry, type WorldEvent } from "@/types/events";

const NULLABLE = ["subtype", "description", "geometry", "geoNote", "locationName", "country", "countryName", "region", "city", "resolvedAt", "aiInterpretation", "seriesKey"] as const;
/** Recomputed on load (see recompute()). */
const DERIVED = ["importanceScore", "importanceFactors", "confidenceScore", "status", "sourceCount"] as const;

type Stored = Record<string, unknown>;

/** ISO timestamps (toISOString form) are stored as epoch milliseconds. */
const toMs = (iso: string | null | undefined): unknown => {
  if (typeof iso !== "string") return iso;
  const t = Date.parse(iso);
  return Number.isFinite(t) && new Date(t).toISOString() === iso ? t : iso;
};
const fromMs = (v: unknown): unknown => (typeof v === "number" ? new Date(v).toISOString() : v);
const EVENT_TIMES = ["timestamp", "updatedAt", "createdAt", "resolvedAt"] as const;

/**
 * Snapshot-wide table for strings repeated on almost every source record
 * (publisher name, credibility basis, source type + assertion): stored once,
 * referenced by index.
 */
export class StringTable {
  readonly strings: string[] = [];
  private readonly ids = new Map<string, number>();
  constructor(initial: string[] = []) {
    for (const s of initial) this.ref(s);
  }
  ref(s: string): number {
    let i = this.ids.get(s);
    if (i === undefined) {
      i = this.strings.length;
      this.strings.push(s);
      this.ids.set(s, i);
    }
    return i;
  }
  get(i: number): string {
    return this.strings[i];
  }
}

function initialEntry(e: WorldEvent): TimelineEntry | null {
  const s = e.sources[0];
  if (!s) return null;
  const final = s.assertion === "OFFICIAL_FINAL";
  return { at: s.publishedAt ?? e.timestamp, kind: final ? "OFFICIAL_CONFIRMATION" : "INITIAL_REPORT", label: `${final ? "Confirmed by" : "First reported by"} ${s.sourceName}`, sourceId: s.id };
}

/** Standard per-source timeline lines: code → kind + label prefix. */
const LINES: Record<string, { kind: TimelineEntry["kind"]; prefix: string }> = {
  I: { kind: "INITIAL_REPORT", prefix: "First reported by " },
  C: { kind: "OFFICIAL_CONFIRMATION", prefix: "Confirmed by " },
  A: { kind: "SOURCE_ADDED", prefix: "Also reported by " },
  a: { kind: "OFFICIAL_CONFIRMATION", prefix: "Also reported by " },
};
/** Placeholder for the event title inside the stored summary. */
const TITLE_MARK = "\u0001";

function encodeEntry(t: TimelineEntry, sources: EventSource[]): TimelineEntry | string {
  const i = sources.findIndex((s) => s.id === t.sourceId);
  const s = sources[i];
  if (!s || t.at !== s.publishedAt) return { ...t, at: toMs(t.at) as string };
  for (const [code, line] of Object.entries(LINES)) if (line.kind === t.kind && t.label === line.prefix + s.sourceName) return `${code}${i}`;
  return t;
}

function decodeEntry(t: TimelineEntry | string, sources: EventSource[]): TimelineEntry {
  if (typeof t !== "string") return { ...t, at: fromMs(t.at) as string };
  const line = LINES[t[0]], s = sources[Number(t.slice(1))];
  return { at: s.publishedAt!, kind: line.kind, label: line.prefix + s.sourceName, sourceId: s.id };
}

const sameEntry = (a: TimelineEntry, b: TimelineEntry | null) => !!b && a.at === b.at && a.kind === b.kind && a.label === b.label && a.sourceId === b.sourceId;

function encodeSource(s: EventSource, eventTitle: string, table?: StringTable): Stored {
  const o: Stored = { ...s };
  if (table) {
    o.sourceName = table.ref(s.sourceName);
    delete o.sourceType;
    delete o.assertion;
    o.kind = table.ref(`${s.sourceType}|${s.assertion}`);
    if (s.credibility && Object.keys(s.credibility).length === 1) o.credibility = table.ref(s.credibility.basis);
  }
  if (s.id === `${s.dataSourceId}:${s.externalId}`) {
    delete o.dataSourceId;
    delete o.externalId;
  }
  if (s.title !== null && s.title === eventTitle) delete o.title;
  else if (s.title === null) o.title = null;
  if (!s.titleIsDerived) delete o.titleIsDerived;
  if (s.credibility === null) delete o.credibility;
  o.publishedAt = toMs(s.publishedAt);
  o.retrievedAt = toMs(s.retrievedAt);
  return o;
}

function decodeSource(o: Stored, eventTitle: string, table?: StringTable): EventSource {
  const id = o.id as string;
  const cut = id.indexOf(":");
  const str = (v: unknown) => (typeof v === "number" && table ? table.get(v) : v);
  const kind = typeof o.kind === "number" ? str(o.kind) as string : null;
  const { kind: _kind, ...rest } = o;
  void _kind;
  return {
    ...(rest as unknown as EventSource),
    sourceName: str(o.sourceName) as string,
    ...(kind ? { sourceType: kind.split("|")[0] as EventSource["sourceType"], assertion: kind.split("|")[1] as EventSource["assertion"] } : {}),
    dataSourceId: (o.dataSourceId as string | undefined) ?? id.slice(0, cut),
    externalId: (o.externalId as string | undefined) ?? id.slice(cut + 1),
    title: "title" in o ? (o.title as string | null) : eventTitle,
    titleIsDerived: (o.titleIsDerived as boolean | undefined) ?? false,
    publishedAt: fromMs(o.publishedAt) as string | null,
    retrievedAt: fromMs(o.retrievedAt) as string,
    credibility: typeof o.credibility === "number" ? { basis: str(o.credibility) as string } : ((o.credibility as EventSource["credibility"] | undefined) ?? null),
  };
}

export function encodeEvent(e: WorldEvent, table?: StringTable): Stored {
  const o: Stored = { ...e, sources: e.sources.map((s) => encodeSource(s, e.title, table)) };
  for (const k of NULLABLE) if (e[k] === null || e[k] === undefined) delete o[k];
  for (const k of DERIVED) delete o[k];
  delete o.outletCount;
  if (e.createdAt === e.updatedAt) delete o.createdAt;
  if (e.lastEvidenceAt === e.updatedAt) o.lastEvidenceAt = 0; // 0 = "same as updatedAt" (absent = not tracked yet)
  if (e.timeline.length === 1 && sameEntry(e.timeline[0], initialEntry(e))) delete o.timeline;
  else o.timeline = e.timeline.map((t) => encodeEntry(t, e.sources));
  if (e.title.length >= 12 && !e.summary.includes(TITLE_MARK) && e.summary.split(e.title).length === 2) o.summary = e.summary.replace(e.title, TITLE_MARK);
  for (const k of EVENT_TIMES) if (k in o) o[k] = toMs(e[k]);
  if (typeof o.lastEvidenceAt === "string") o.lastEvidenceAt = toMs(e.lastEvidenceAt);
  if (!Object.keys(e.rawData).length) delete o.rawData;
  if (!e.relatedEventIds.length) delete o.relatedEventIds;
  if (!e.entities.length) delete o.entities;
  // Entities as [typeIndex, name] or [typeIndex, name, code].
  else o.entities = e.entities.map((x) => (x.code === null ? [ENTITY_TYPES.indexOf(x.type), x.name] : [ENTITY_TYPES.indexOf(x.type), x.name, x.code]));
  if (!e.isSynthetic) delete o.isSynthetic;
  return o;
}

/** Restore a stored event. Scores are placeholders until recompute() runs. */
export function decodeEvent(o: Stored, table?: StringTable): WorldEvent {
  const title = o.title as string;
  o = { ...o };
  for (const k of EVENT_TIMES) if (k in o) o[k] = fromMs(o[k]);
  if (typeof o.lastEvidenceAt === "number" && o.lastEvidenceAt !== 0) o.lastEvidenceAt = fromMs(o.lastEvidenceAt);
  const e = {
    ...(o as unknown as WorldEvent),
    sources: (o.sources as Stored[]).map((s) => decodeSource(s, title, table)),
    createdAt: (o.createdAt as string | undefined) ?? (o.updatedAt as string),
    rawData: (o.rawData as WorldEvent["rawData"] | undefined) ?? {},
    relatedEventIds: (o.relatedEventIds as string[] | undefined) ?? [],
    entities: ((o.entities as Array<Entity | [number, string, string?]> | undefined) ?? []).map((x) =>
      Array.isArray(x) ? { type: ENTITY_TYPES[x[0]], name: x[1], code: x[2] ?? null } : x,
    ),
    isSynthetic: (o.isSynthetic as boolean | undefined) ?? false,
    importanceScore: (o.importanceScore as number | undefined) ?? 0,
    importanceFactors: (o.importanceFactors as WorldEvent["importanceFactors"] | undefined) ?? [],
    confidenceScore: (o.confidenceScore as number | undefined) ?? 0,
    status: (o.status as WorldEvent["status"] | undefined) ?? "UNVERIFIED",
    sourceCount: (o.sourceCount as number | undefined) ?? 0,
  } as WorldEvent;
  for (const k of NULLABLE) if (!(k in o)) (e as Record<string, unknown>)[k] = null;
  if (o.lastEvidenceAt === 0) e.lastEvidenceAt = e.updatedAt;
  if (!("timeline" in o)) e.timeline = [initialEntry(e)].filter((t): t is TimelineEntry => !!t);
  else e.timeline = (o.timeline as Array<TimelineEntry | string>).map((t) => decodeEntry(t, e.sources));
  if (e.summary.includes(TITLE_MARK)) e.summary = e.summary.replace(TITLE_MARK, () => title);
  return e;
}
