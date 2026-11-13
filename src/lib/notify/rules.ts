/**
 * User-defined alert rules ("tell me about any M6+ earthquake in Japan", "anything from
 * OFAC mentioning Iran"). Pure: schema, matching and per-tick selection. Storage and
 * posting live in rules-server.ts; the UI is Settings → Alerts.
 *
 * Every filter that is set must match (AND); inside a filter any value matches (OR).
 * Keywords match case-insensitively in the title or summary.
 */
import { z } from "zod";
import { EventCategorySchema, type EventCategory } from "@/types/events";

export const MAX_RULES = 50;
/** Most rule alerts posted in one tick, across all rules (Discord rate limits, no floods). */
export const MAX_RULE_ALERTS_PER_TICK = 6;
/** Most events posted for one rule in one tick (one message, up to this many embeds). */
export const MAX_PER_RULE_PER_TICK = 4;

export const AlertRuleSchema = z
  .object({
    id: z.string().regex(/^[\w-]{1,40}$/),
    name: z.string().trim().min(1).max(80),
    enabled: z.boolean(),
    types: z.array(EventCategorySchema).max(20).optional(),
    countries: z
      .array(z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, "ISO 3166-1 alpha-2 code"))
      .max(60)
      .optional(),
    sources: z.array(z.string().trim().regex(/^[\w.-]{1,60}$/)).max(120).optional(),
    keywords: z.array(z.string().trim().min(2).max(60)).max(20).optional(),
    minImportance: z.number().min(0).max(100).optional(),
    /** Set by the server when the rule is first saved; only events first seen after it alert. */
    createdAt: z.string().datetime().optional(),
  })
  .refine((r) => !!(r.types?.length || r.countries?.length || r.sources?.length || r.keywords?.length || r.minImportance !== undefined), {
    message: "Set at least one filter (type, country, source, keyword or minimum importance)",
  });
export type AlertRule = z.infer<typeof AlertRuleSchema>;

export const AlertRulesSchema = z
  .array(AlertRuleSchema)
  .max(MAX_RULES)
  .refine((rs) => new Set(rs.map((r) => r.id)).size === rs.length, { message: "Rule ids must be unique" });

/** The fields a rule looks at (WorldEvent has them all). */
export interface RuleEvent {
  id: string;
  type: EventCategory | string;
  title: string;
  summary: string;
  country: string | null;
  importanceScore: number;
  status?: string;
  isSynthetic?: boolean;
  createdAt?: string;
  timestamp: string;
  sources: Array<{ id: string; dataSourceId: string }>;
}

export function matchesRule(rule: AlertRule, e: RuleEvent): boolean {
  if (rule.types?.length && !rule.types.includes(e.type as EventCategory)) return false;
  if (rule.countries?.length && !(e.country && rule.countries.includes(e.country.toUpperCase()))) return false;
  if (rule.sources?.length && !e.sources.some((s) => rule.sources!.includes(s.dataSourceId))) return false;
  if (rule.minImportance !== undefined && e.importanceScore < rule.minImportance) return false;
  if (rule.keywords?.length) {
    const text = `${e.title}\n${e.summary}`.toLowerCase();
    if (!rule.keywords.some((k) => text.includes(k.toLowerCase()))) return false;
  }
  return true;
}

/** Dedupe keys for a rule hit: the event id and each source record (the sentinel's events have fresh ids). */
export const ruleKeys = (ruleId: string, e: Pick<RuleEvent, "id" | "sources">) => [`${ruleId}|${e.id}`, ...e.sources.map((s) => `${ruleId}|${s.id}`)];

export interface RuleHit<E extends RuleEvent> {
  rule: AlertRule;
  events: E[];
}

/**
 * What to post this tick: for each enabled rule, new matching events (first seen after the rule
 * was created, not resolved, not synthetic, not already posted for that rule), most important
 * first, capped per rule and per tick.
 */
export function selectRuleHits<E extends RuleEvent>(rules: AlertRule[], events: E[], alreadySent: ReadonlySet<string>, opts: { maxTotal?: number; maxPerRule?: number } = {}): RuleHit<E>[] {
  const maxTotal = opts.maxTotal ?? MAX_RULE_ALERTS_PER_TICK;
  const maxPerRule = opts.maxPerRule ?? MAX_PER_RULE_PER_TICK;
  const sorted = events.filter((e) => !e.isSynthetic && e.status !== "RESOLVED").sort((a, b) => b.importanceScore - a.importanceScore);
  const out: RuleHit<E>[] = [];
  let total = 0;
  for (const rule of rules) {
    if (!rule.enabled || total >= maxTotal) continue;
    const since = rule.createdAt ? Date.parse(rule.createdAt) : 0;
    const picked: E[] = [];
    for (const e of sorted) {
      if (picked.length >= maxPerRule || total + picked.length >= maxTotal) break;
      const firstSeen = Date.parse(e.createdAt ?? e.timestamp);
      if (since && !(firstSeen >= since)) continue;
      if (ruleKeys(rule.id, e).some((k) => alreadySent.has(k))) continue;
      if (matchesRule(rule, e)) picked.push(e);
    }
    if (picked.length) {
      out.push({ rule, events: picked });
      total += picked.length;
    }
  }
  return out;
}

/** Keep createdAt from the stored copy of each rule; stamp new rules with `now`. */
export function stampRules(next: AlertRule[], prev: AlertRule[], now = Date.now()): AlertRule[] {
  const old = new Map(prev.map((r) => [r.id, r]));
  return next.map((r) => ({ ...r, createdAt: old.get(r.id)?.createdAt ?? new Date(now).toISOString() }));
}
