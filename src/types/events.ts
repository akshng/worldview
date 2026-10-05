/**
 * Universal event model.
 *
 * Every data source (USGS, GDELT, FIRMS, …) normalises its raw records into
 * `EventCandidate`s; the ingestion pipeline deduplicates, scores and stores them
 * as `WorldEvent`s. See docs/EVENT_MODEL.md for field-level documentation.
 *
 * Naming: TypeScript uses camelCase; the SQL schema (src/lib/db/schema.sql)
 * uses the equivalent snake_case column names.
 */
import { z } from "zod";

export const EVENT_CATEGORIES = [
  "NEWS",
  "POLITICS",
  "CONFLICT",
  "PROTEST",
  "DISASTER",
  "EARTHQUAKE",
  "WEATHER",
  "FIRE",
  "FLOOD",
  "VOLCANO",
  "SPACE",
  "SCIENCE",
  "TECHNOLOGY",
  "BUSINESS",
  "MARKETS",
  "AVIATION",
  "MARITIME",
  "INFRASTRUCTURE",
  "OTHER",
] as const;
export type EventCategory = (typeof EVENT_CATEGORIES)[number];
export const EventCategorySchema = z.enum(EVENT_CATEGORIES);

/**
 * Event status. The system only claims CONFIRMED when an official/authoritative
 * source asserts a final, reviewed record (see src/lib/events/status.ts).
 */
export const EVENT_STATUSES = [
  "UNVERIFIED",
  "REPORTED",
  "PARTIALLY_CONFIRMED",
  "CONFIRMED",
  "RESOLVED",
] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];
export const EventStatusSchema = z.enum(EVENT_STATUSES);

/** What kind of publisher a source is. Factual classification only — never a trust rating. */
export const SOURCE_TYPES = [
  "OFFICIAL_AGENCY", // government / intergovernmental agency (USGS, NWS, GDACS)
  "SCIENTIFIC", // research / science programme (NASA EONET)
  "SATELLITE", // instrument detections (NASA FIRMS)
  "NEWS_MEDIA", // a news publisher's article
  "NEWS_AGGREGATOR", // machine-coded news event databases (GDELT)
  "COMMUNITY_DATABASE", // curated community databases (Launch Library 2)
  "SYNTHETIC", // demo-mode generator. Never real.
] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

/**
 * What the source is asserting. Used to derive event status deterministically.
 *  OFFICIAL_FINAL        – authoritative, reviewed record (e.g. USGS "reviewed")
 *  OFFICIAL_PRELIMINARY  – authoritative but automatic/preliminary (USGS "automatic", alerts)
 *  MEASUREMENT           – instrument detection (satellite hotspot)
 *  MEDIA_REPORT          – a news report about the event
 *  SCHEDULED             – a planned future event (launch schedule)
 *  SYNTHETIC             – fabricated for demo mode
 */
export const SOURCE_ASSERTIONS = [
  "OFFICIAL_FINAL",
  "OFFICIAL_PRELIMINARY",
  "MEASUREMENT",
  "MEDIA_REPORT",
  "SCHEDULED",
  "SYNTHETIC",
] as const;
export type SourceAssertion = (typeof SOURCE_ASSERTIONS)[number];

const httpUrl = z
  .string()
  .url()
  .refine((u) => /^https?:\/\//i.test(u), "Only http(s) URLs are allowed");

export const EventSourceSchema = z.object({
  /** Stable id of this source record: `${dataSourceId}:${externalId}` */
  id: z.string().min(1),
  /** Connector that produced it, e.g. "usgs" */
  dataSourceId: z.string().min(1),
  /** Identifier of the record inside the upstream source */
  externalId: z.string().min(1),
  /** Human-readable publisher, e.g. "USGS Earthquake Hazards Program" or "reuters.com" */
  sourceName: z.string().min(1),
  sourceUrl: httpUrl.nullable(),
  /** Title of the source record/article if the upstream provides one */
  title: z.string().nullable(),
  /** True when `title` was derived heuristically (e.g. from a URL slug) rather than published */
  titleIsDerived: z.boolean().default(false),
  publishedAt: z.string().datetime().nullable(),
  retrievedAt: z.string().datetime(),
  sourceType: z.enum(SOURCE_TYPES),
  assertion: z.enum(SOURCE_ASSERTIONS),
  /**
   * Factual metadata about the publisher, if available. Never an invented rating.
   * e.g. { basis: "U.S. federal agency" }
   */
  credibility: z.object({ basis: z.string() }).nullable().default(null),
});
export type EventSource = z.infer<typeof EventSourceSchema>;

export const ENTITY_TYPES = [
  "PERSON",
  "ORGANIZATION",
  "COUNTRY",
  "LOCATION",
  "ACTOR",
  "VEHICLE",
  "TOPIC",
  "OTHER",
] as const;
export const EntitySchema = z.object({
  type: z.enum(ENTITY_TYPES),
  name: z.string().min(1),
  /** Optional machine code (ISO country code, CAMEO actor code, …) */
  code: z.string().nullable().default(null),
});
export type Entity = z.infer<typeof EntitySchema>;

export const GEO_PRECISIONS = ["exact", "city", "region", "country", "approximate"] as const;
export type GeoPrecision = (typeof GEO_PRECISIONS)[number];

export const TIMELINE_KINDS = [
  "INITIAL_REPORT",
  "OFFICIAL_CONFIRMATION",
  "UPDATE",
  "SOURCE_ADDED",
  "RESOLVED",
] as const;
export const TimelineEntrySchema = z.object({
  at: z.string().datetime(),
  kind: z.enum(TIMELINE_KINDS),
  label: z.string(),
  sourceId: z.string().nullable().default(null),
});
export type TimelineEntry = z.infer<typeof TimelineEntrySchema>;

/** Scalar metrics specific to an event type (magnitude, depth_km, frp_mw, …). */
export const MetricsSchema = z.record(
  z.string(),
  z.union([z.number(), z.string(), z.boolean(), z.null()]),
);
export type EventMetrics = z.infer<typeof MetricsSchema>;

const ring = z.array(z.tuple([z.number(), z.number()])).min(4);
/** Affected area for events that are areas (warning polygons, fire clusters). Simplified. */
export const AreaGeometrySchema = z.union([
  z.object({ type: z.literal("Polygon"), coordinates: z.array(ring).min(1) }),
  z.object({ type: z.literal("MultiPolygon"), coordinates: z.array(z.array(ring).min(1)).min(1) }),
]);
export type AreaGeometry = z.infer<typeof AreaGeometrySchema>;

/** How a location was determined/changed, shown to users for transparency. */
export const GeoNoteSchema = z.object({
  method: z.string(),
  detail: z.string(),
});
export type GeoNote = z.infer<typeof GeoNoteSchema>;

export const ImportanceFactorSchema = z.object({
  factor: z.string(),
  points: z.number(),
  detail: z.string(),
});
export type ImportanceFactor = z.infer<typeof ImportanceFactorSchema>;

/** AI-generated text. Stored separately and always labelled as interpretation, never fact. */
export const AIInterpretationSchema = z.object({
  text: z.string(),
  provider: z.string(),
  model: z.string(),
  generatedAt: z.string().datetime(),
});
export type AIInterpretation = z.infer<typeof AIInterpretationSchema>;

const lat = z.number().min(-90).max(90);
const lon = z.number().min(-180).max(180);

/**
 * What a connector produces. One candidate = one source's view of one event.
 */
export const EventCandidateSchema = z.object({
  type: EventCategorySchema,
  subtype: z.string().nullable().default(null),
  title: z.string().min(3).max(300),
  /** Verified factual summary, derived only from the source data */
  summary: z.string().max(2000),
  description: z.string().max(8000).nullable().default(null),
  latitude: lat,
  longitude: lon,
  geoPrecision: z.enum(GEO_PRECISIONS),
  /** Affected area, when the source provides one (point = representative interior point) */
  geometry: AreaGeometrySchema.nullable().default(null),
  locationName: z.string().nullable().default(null),
  /** ISO 3166-1 alpha-2 if known; reverse-geocoded by the pipeline when null */
  country: z.string().nullable().default(null),
  city: z.string().nullable().default(null),
  /** When the event happened (or is scheduled to happen) */
  timestamp: z.string().datetime(),
  /** When the event ended/was resolved according to the source, if known */
  resolvedAt: z.string().datetime().nullable().default(null),
  metrics: MetricsSchema.default({}),
  entities: z.array(EntitySchema).default([]),
  source: EventSourceSchema,
  /**
   * Source record ids (`dataSourceId:externalId`) this record replaces — e.g. an
   * NWS alert update supersedes the previous alert message. The event is updated
   * in place instead of creating a duplicate.
   */
  supersedes: z.array(z.string()).default([]),
  /** Trimmed raw upstream record, for traceability/debugging */
  rawData: z.unknown().optional(),
  isSynthetic: z.boolean().default(false),
});
export type EventCandidate = z.infer<typeof EventCandidateSchema>;
export type EventCandidateInput = z.input<typeof EventCandidateSchema>;

export const WorldEventSchema = z.object({
  id: z.string().min(1),
  type: EventCategorySchema,
  subtype: z.string().nullable(),
  title: z.string(),
  /** verified_summary – facts only */
  summary: z.string(),
  description: z.string().nullable(),
  latitude: lat,
  longitude: lon,
  geoPrecision: z.enum(GEO_PRECISIONS),
  geometry: AreaGeometrySchema.nullable().optional(),
  /** Set when the pipeline refined/corrected the source location */
  geoNote: GeoNoteSchema.nullable().optional(),
  locationName: z.string().nullable(),
  country: z.string().nullable(),
  countryName: z.string().nullable(),
  region: z.string().nullable(),
  city: z.string().nullable(),
  timestamp: z.string().datetime(),
  resolvedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  importanceScore: z.number().min(0).max(100),
  importanceFactors: z.array(ImportanceFactorSchema),
  confidenceScore: z.number().min(0).max(1),
  sourceCount: z.number().int().min(0),
  sources: z.array(EventSourceSchema),
  entities: z.array(EntitySchema),
  relatedEventIds: z.array(z.string()),
  status: EventStatusSchema,
  metrics: MetricsSchema,
  timeline: z.array(TimelineEntrySchema),
  /** ai_interpretation – separate from facts, nullable until generated */
  aiInterpretation: AIInterpretationSchema.nullable(),
  isSynthetic: z.boolean(),
  /** Raw upstream records keyed by source id */
  rawData: z.record(z.string(), z.unknown()),
});
export type WorldEvent = z.infer<typeof WorldEventSchema>;

/** Lightweight projection sent to the map/feed. */
export type EventSummary = Pick<
  WorldEvent,
  | "id"
  | "type"
  | "subtype"
  | "title"
  | "summary"
  | "latitude"
  | "longitude"
  | "locationName"
  | "country"
  | "countryName"
  | "timestamp"
  | "updatedAt"
  | "importanceScore"
  | "sourceCount"
  | "status"
  | "isSynthetic"
  | "metrics"
  | "geoPrecision"
> & { primarySource: string; area: AreaGeometry | null };

export type EventRelationshipType =
  | "SAME_STORY"
  | "CAUSED_BY"
  | "TRIGGERED"
  | "NEARBY"
  | "POSSIBLY_RELATED";

export interface EventRelationship {
  fromEventId: string;
  toEventId: string;
  type: EventRelationshipType;
  /** How the relationship was established, e.g. "rule:proximity" or "ai:…" */
  basis: string;
  createdAt: string;
}

export function toEventSummary(e: WorldEvent): EventSummary {
  return {
    id: e.id,
    type: e.type,
    subtype: e.subtype,
    title: e.title,
    summary: e.summary,
    latitude: e.latitude,
    longitude: e.longitude,
    locationName: e.locationName,
    country: e.country,
    countryName: e.countryName,
    timestamp: e.timestamp,
    updatedAt: e.updatedAt,
    importanceScore: e.importanceScore,
    sourceCount: e.sourceCount,
    status: e.status,
    isSynthetic: e.isSynthetic,
    metrics: e.metrics,
    geoPrecision: e.geoPrecision,
    area: e.geometry ?? null,
    primarySource: e.sources[0]?.sourceName ?? "Unknown",
  };
}
