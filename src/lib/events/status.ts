/**
 * Deterministic event status + confidence derivation from the sources that
 * support an event. The system never claims CONFIRMED without an authoritative
 * final record. Rules (documented in docs/EVENT_MODEL.md):
 *
 *   RESOLVED             – the authoritative source reports the event as ended/expired
 *   CONFIRMED            – at least one OFFICIAL_FINAL source
 *   PARTIALLY_CONFIRMED  – an official-preliminary or measurement source PLUS at least
 *                          one independent corroborating source
 *   REPORTED             – a single official-preliminary/measurement/scheduled source, or
 *                          media reports from ≥ 2 independent publishers
 *   UNVERIFIED           – a single media report, or synthetic data
 */
import type { EventSource, EventStatus, GeoPrecision } from "@/types/events";

/** Publisher identity used to count *independent* sources. */
export function publisherKey(s: EventSource): string {
  if (s.sourceUrl) {
    try {
      return new URL(s.sourceUrl).hostname.replace(/^www\./, "").toLowerCase();
    } catch {
      /* fall through */
    }
  }
  return `${s.dataSourceId}:${s.sourceName}`.toLowerCase();
}

export function independentPublisherCount(sources: EventSource[]): number {
  return new Set(sources.map(publisherKey)).size;
}

export function deriveStatus(sources: EventSource[], resolvedAt: string | null, now = Date.now()): EventStatus {
  if (sources.length === 0) return "UNVERIFIED";
  if (sources.every((s) => s.assertion === "SYNTHETIC")) return "UNVERIFIED";
  if (resolvedAt && Date.parse(resolvedAt) <= now) return "RESOLVED";

  const has = (a: EventSource["assertion"]) => sources.some((s) => s.assertion === a);
  if (has("OFFICIAL_FINAL")) return "CONFIRMED";

  const publishers = independentPublisherCount(sources);
  const strong = sources.filter(
    (s) => s.assertion === "OFFICIAL_PRELIMINARY" || s.assertion === "MEASUREMENT",
  );
  if (strong.length > 0) return publishers >= 2 ? "PARTIALLY_CONFIRMED" : "REPORTED";
  if (has("SCHEDULED")) return "REPORTED";

  const media = sources.filter((s) => s.assertion === "MEDIA_REPORT");
  if (independentPublisherCount(media) >= 2) return "REPORTED";
  return "UNVERIFIED";
}

const ASSERTION_WEIGHT: Record<EventSource["assertion"], number> = {
  OFFICIAL_FINAL: 0.95,
  OFFICIAL_PRELIMINARY: 0.8,
  MEASUREMENT: 0.75,
  SCHEDULED: 0.7,
  MEDIA_REPORT: 0.4,
  SYNTHETIC: 0,
};

const GEO_WEIGHT: Record<GeoPrecision, number> = {
  exact: 1,
  city: 0.95,
  region: 0.85,
  country: 0.7,
  approximate: 0.6,
};

/**
 * Confidence (0–1) that the event, as located, is real. Combines the strongest
 * source assertion, corroboration by independent publishers and geo precision.
 */
export function deriveConfidence(sources: EventSource[], geoPrecision: GeoPrecision): number {
  if (sources.length === 0) return 0;
  const best = Math.max(...sources.map((s) => ASSERTION_WEIGHT[s.assertion]));
  if (best === 0) return 0;
  const extra = Math.min(independentPublisherCount(sources) - 1, 4) * 0.05;
  const raw = Math.min(1, best + extra) * GEO_WEIGHT[geoPrecision];
  return Math.round(raw * 100) / 100;
}
