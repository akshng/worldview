/**
 * Event deduplication: decides whether an incoming candidate describes the
 * same real-world event as an existing event.
 *
 * Signals (V1, deterministic):
 *   - geographic proximity   (haversine distance vs. per-type radius)
 *   - temporal proximity     (|Δt| vs. per-type window)
 *   - semantic similarity    (token Jaccard over titles — a cheap stand-in for embeddings)
 *   - entity overlap         (shared actors / organisations / places)
 *   - type-specific checks   (e.g. earthquake magnitudes must agree)
 *
 * The interface (`matchScore`, `findBestMatch`) is designed so an AI/embedding
 * based matcher can replace or augment the scoring later.
 */
import type { Entity, EventCategory, EventMetrics } from "@/types/events";
import { haversineKm } from "@/lib/geo/math";

export interface Comparable {
  type: EventCategory;
  subtype: string | null;
  title: string;
  latitude: number;
  longitude: number;
  timestamp: string;
  entities: Entity[];
  metrics: EventMetrics;
  /** Connectors that contributed to this event */
  dataSourceIds: string[];
}

export interface DedupRule {
  radiusKm: number;
  windowMs: number;
  /** Minimum title similarity required (0 = not required) */
  minTextSimilarity: number;
  /** Extra veto check, e.g. magnitude agreement */
  compatible?: (a: Comparable, b: Comparable) => boolean;
  /**
   * Near-identical, specific text (≥ 0.8 similarity, ≥ 6 words) may match over this larger radius —
   * syndicated news copies of one story are often geocoded to different cities.
   */
  strongTextRadiusKm?: number;
}

const H = 3_600_000;

const magnitudesAgree = (a: Comparable, b: Comparable) => {
  const ma = a.metrics.magnitude, mb = b.metrics.magnitude;
  if (typeof ma !== "number" || typeof mb !== "number") return true;
  return Math.abs(ma - mb) <= 0.7;
};

export const DEDUP_RULES: Partial<Record<EventCategory, DedupRule>> = {
  EARTHQUAKE: { radiusKm: 100, windowMs: 3 * 60_000, minTextSimilarity: 0, compatible: magnitudesAgree },
  WEATHER: { radiusKm: 350, windowMs: 72 * H, minTextSimilarity: 0.34 },
  FLOOD: { radiusKm: 250, windowMs: 96 * H, minTextSimilarity: 0.2 },
  VOLCANO: { radiusKm: 40, windowMs: 21 * 24 * H, minTextSimilarity: 0 },
  FIRE: { radiusKm: 25, windowMs: 48 * H, minTextSimilarity: 0.2 },
  DISASTER: { radiusKm: 250, windowMs: 96 * H, minTextSimilarity: 0.3 },
  SPACE: { radiusKm: 50, windowMs: 6 * H, minTextSimilarity: 0.5 },
};
export const DEFAULT_NEWS_RULE: DedupRule = { radiusKm: 30, windowMs: 18 * H, minTextSimilarity: 0.3, strongTextRadiusKm: 800 };

export const MATCH_THRESHOLD = 0.55;

const STOPWORDS = new Set(
  "the a an of in on at to for from by with and or near over under after before into is are was were be has have had its it this that as than new says said report reported reports km mi via about amid".split(" "),
);

export function tokenize(s: string): Set<string> {
  const out = new Set<string>();
  for (const t of s.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/)) {
    if (t.length > 2 && !STOPWORDS.has(t)) out.add(t);
  }
  return out;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

export function entityOverlap(a: Entity[], b: Entity[]): number {
  if (!a.length || !b.length) return 0;
  const key = (e: Entity) => `${e.type}:${(e.code ?? e.name).toLowerCase()}`;
  const sa = new Set(a.map(key));
  const sb = new Set(b.map(key));
  let inter = 0;
  for (const x of sa) if (sb.has(x)) inter++;
  return inter / Math.min(sa.size, sb.size);
}

export interface MatchOptions {
  /** Connectors whose own records may be merged with each other (news aggregators). */
  mergeWithinSource: ReadonlySet<string>;
}

export interface MatchResult {
  score: number;
  reasons: string[];
}

export function ruleFor(type: EventCategory): DedupRule {
  return DEDUP_RULES[type] ?? DEFAULT_NEWS_RULE;
}

/** Returns null when the two cannot be the same event; otherwise a 0–1 score. */
export function matchScore(a: Comparable, b: Comparable, opts: MatchOptions): MatchResult | null {
  if (a.type !== b.type) return null;
  const rule = ruleFor(a.type);

  // Two records from the same authoritative feed are distinct events by definition
  // (e.g. two USGS quakes). Only aggregators may self-merge.
  const shared = a.dataSourceIds.filter((d) => b.dataSourceIds.includes(d));
  const onlySameSource =
    shared.length > 0 && a.dataSourceIds.length === 1 && b.dataSourceIds.length === 1;
  if (onlySameSource && !opts.mergeWithinSource.has(shared[0])) return null;

  const ta = tokenize(a.title), tb = tokenize(b.title);
  const text = jaccard(ta, tb);
  // Only specific headlines (≥ 6 meaningful words) qualify for the wide radius.
  const specific = Math.min(ta.size, tb.size) >= 6;
  const radiusKm = rule.strongTextRadiusKm && text >= 0.8 && specific ? rule.strongTextRadiusKm : rule.radiusKm;
  const dKm = haversineKm(a.latitude, a.longitude, b.latitude, b.longitude);
  if (dKm > radiusKm) return null;
  const dt = Math.abs(Date.parse(a.timestamp) - Date.parse(b.timestamp));
  if (dt > rule.windowMs) return null;
  if (rule.compatible && !rule.compatible(a, b)) return null;
  if (text < rule.minTextSimilarity) return null;
  const ent = entityOverlap(a.entities, b.entities);

  const geo = 1 - dKm / radiusKm;
  const time = 1 - dt / rule.windowMs;
  // When text similarity is not required for a type, don't penalise its absence.
  const textWeight = rule.minTextSimilarity > 0 ? 0.25 : 0;
  const entWeight = 0.15;
  const geoWeight = rule.minTextSimilarity > 0 ? 0.35 : 0.5;
  const timeWeight = 1 - textWeight - entWeight - geoWeight;
  const entityTerm = a.entities.length && b.entities.length ? ent : 0.5; // neutral if unknown

  const score = geo * geoWeight + time * timeWeight + text * textWeight + entityTerm * entWeight;
  return {
    score: Math.round(score * 1000) / 1000,
    reasons: [
      `${dKm.toFixed(1)} km apart`,
      `${Math.round(dt / 60_000)} min apart`,
      `title similarity ${text.toFixed(2)}`,
      `entity overlap ${ent.toFixed(2)}`,
    ],
  };
}

export function findBestMatch<T extends Comparable>(
  candidate: Comparable,
  pool: Iterable<T>,
  opts: MatchOptions,
  threshold = MATCH_THRESHOLD,
): { match: T; result: MatchResult } | null {
  let best: { match: T; result: MatchResult } | null = null;
  for (const e of pool) {
    const r = matchScore(candidate, e, opts);
    if (r && r.score >= threshold && (!best || r.score > best.result.score)) best = { match: e, result: r };
  }
  return best;
}
