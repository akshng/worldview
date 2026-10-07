/**
 * Shared shape for government travel advisories (US, UK, Canada, Australia).
 * Each record is one government's current advice for one destination at the
 * destination country's label point; a change of advice level supersedes the
 * record for the previous level.
 */
import type { EventCandidateInput, EventMetrics } from "@/types/events";
import type { Country } from "@/lib/geo/gazetteer";

/** Advisories updated longer ago than this are not news. */
export const ADVISORY_MAX_AGE_MS = 30 * 86_400_000;

export interface AdvisoryInput {
  dataSourceId: string;
  /** Destination key used in record ids (country code or upstream slug) */
  key: string;
  /** Current advice level key; records for `allLevels` other than this are superseded */
  level: string;
  allLevels: readonly string[];
  country: Country;
  /** Destination as the government names it */
  place: string;
  title: string;
  summary: string;
  description: string | null;
  updated: Date;
  url: string | null;
  government: { name: string; code: string };
  sourceName: string;
  credibility: string;
  metrics: EventMetrics;
  upstreamTitle: string;
  rawData: Record<string, unknown>;
  retrievedAt: string;
}

export function advisoryCandidate(a: AdvisoryInput): EventCandidateInput {
  const [lon, lat] = a.country.label;
  const recordId = (level: string) => `${a.dataSourceId}:${a.key}:${level}`;
  return {
    type: "POLITICS",
    subtype: "travel advisory",
    title: a.title,
    summary: a.summary,
    description: a.description || null,
    latitude: lat,
    longitude: lon,
    geoPrecision: "country",
    locationName: a.country.name,
    country: a.country.code,
    timestamp: a.updated.toISOString(),
    metrics: a.metrics,
    entities: [
      { type: "ORGANIZATION", name: a.government.name, code: a.government.code },
      { type: "COUNTRY", name: a.country.name, code: a.country.code },
    ],
    source: {
      id: recordId(a.level),
      dataSourceId: a.dataSourceId,
      externalId: `${a.key}:${a.level}`,
      sourceName: a.sourceName,
      sourceUrl: a.url,
      title: a.upstreamTitle,
      titleIsDerived: false,
      publishedAt: a.updated.toISOString(),
      retrievedAt: a.retrievedAt,
      sourceType: "OFFICIAL_AGENCY",
      assertion: "OFFICIAL_FINAL",
      credibility: { basis: a.credibility },
    },
    supersedes: a.allLevels.filter((l) => l !== a.level).map(recordId),
    rawData: a.rawData,
  };
}

/** True when `d` is a valid date no older than the advisory window. */
export function isRecent(d: Date | null, now: number): d is Date {
  return !!d && !Number.isNaN(d.getTime()) && now - d.getTime() <= ADVISORY_MAX_AGE_MS && d.getTime() - now < 86_400_000;
}
