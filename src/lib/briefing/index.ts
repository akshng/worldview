/**
 * Daily briefing (the future 7:30 AM briefing).
 *
 * The structure is built deterministically from stored events — every item
 * references an event id. The AI service can then write a narrative from this
 * structure (stored separately and labelled as interpretation).
 */
import { toEventSummary, type EventSummary, type WorldEvent } from "@/types/events";
import { CATEGORIES, HAZARD_CATEGORIES } from "@/lib/categories";

export type ChangeKind = "NEW" | "DEVELOPING" | "ONGOING" | "RESOLVED";

export interface BriefingItem {
  change: ChangeKind;
  event: EventSummary;
}

export interface BriefingSection {
  id: string;
  title: string;
  items: BriefingItem[];
}

export interface CategoryComparison {
  category: string;
  label: string;
  today: number;
  yesterday: number;
}

export interface DailyBriefing {
  generatedAt: string;
  periodStart: string;
  periodEnd: string;
  greeting: string;
  topDevelopments: BriefingItem[];
  changes: Record<ChangeKind, number>;
  /** Events per category: last 24 h vs the 24 h before */
  comparison: CategoryComparison[];
  sections: BriefingSection[];
  whatToWatch: BriefingItem[];
  /** Days of history available; comparisons are partial when < 2 */
  historyDays: number;
  /** AI narrative, when generated. Always labelled as interpretation. */
  aiNarrative: { text: string; provider: string; model: string; generatedAt: string } | null;
}

const DAY = 86_400_000;

/** When the real-world event began: source start time if known, else first report. */
export function startedAt(e: WorldEvent): number {
  const metric = typeof e.metrics.started_at === "string" ? Date.parse(e.metrics.started_at) : NaN;
  const firstReport = Math.min(...e.timeline.map((t) => Date.parse(t.at)).filter(Number.isFinite), Date.parse(e.timestamp));
  return Number.isFinite(metric) ? Math.min(metric, firstReport) : firstReport;
}

export function classifyChange(e: WorldEvent, now: number): ChangeKind {
  const since = now - DAY;
  if (e.status === "RESOLVED" && e.resolvedAt && Date.parse(e.resolvedAt) >= since) return "RESOLVED";
  if (startedAt(e) >= since) return "NEW";
  const developed =
    Date.parse(e.timestamp) >= since ||
    e.timeline.some((t) => t.kind !== "INITIAL_REPORT" && Date.parse(t.at) >= since);
  return developed ? "DEVELOPING" : "ONGOING";
}

const SECTIONS: Array<{ id: string; title: string; match: (e: WorldEvent) => boolean }> = [
  { id: "us", title: "United States", match: (e) => e.country === "US" },
  { id: "europe", title: "Europe", match: (e) => e.region === "Europe" },
  { id: "asia", title: "Asia & Pacific", match: (e) => e.region === "Asia" || e.region === "Oceania" },
  { id: "middle-east", title: "Middle East", match: (e) => e.region === "Middle East" },
  { id: "africa", title: "Africa", match: (e) => e.region === "Africa" },
  { id: "latam", title: "Latin America", match: (e) => e.region === "Latin America" },
  { id: "markets", title: "Markets & business", match: (e) => e.type === "MARKETS" || e.type === "BUSINESS" },
  { id: "scitech", title: "Science, technology & space", match: (e) => e.type === "SCIENCE" || e.type === "TECHNOLOGY" || e.type === "SPACE" },
  { id: "disasters", title: "Disasters & hazards", match: (e) => (HAZARD_CATEGORIES as string[]).includes(e.type) },
];

/** Satellite fire clusters are numerous; keep a few of the largest so they don't swamp sections. */
function diversify(list: WorldEvent[], limit: number): WorldEvent[] {
  const out: WorldEvent[] = [];
  let fires = 0;
  for (const e of list) {
    if (e.subtype === "satellite-detections" && ++fires > 2) continue;
    out.push(e);
    if (out.length >= limit) break;
  }
  return out;
}

export function buildDailyBriefing(events: WorldEvent[], now = Date.now()): DailyBriefing {
  const real = events.filter((e) => !e.isSynthetic);
  const start = now - DAY;
  const active = (e: WorldEvent) =>
    Date.parse(e.timestamp) >= start || Date.parse(e.updatedAt) >= start || (e.resolvedAt !== null && Date.parse(e.resolvedAt) >= start);
  const relevant = real.filter((e) => active(e) && Date.parse(e.timestamp) <= now);
  const ranked = [...relevant].sort((a, b) => b.importanceScore - a.importanceScore);
  const item = (e: WorldEvent): BriefingItem => ({ change: classifyChange(e, now), event: toEventSummary(e) });

  const changes: Record<ChangeKind, number> = { NEW: 0, DEVELOPING: 0, ONGOING: 0, RESOLVED: 0 };
  for (const e of relevant) changes[classifyChange(e, now)]++;

  const counts = new Map<string, { today: number; yesterday: number }>();
  for (const e of real) {
    const t = Date.parse(e.timestamp);
    if (t > now || t < now - 2 * DAY) continue;
    const c = counts.get(e.type) ?? { today: 0, yesterday: 0 };
    if (t >= start) c.today++;
    else c.yesterday++;
    counts.set(e.type, c);
  }
  const oldest = Math.min(...real.map((e) => Date.parse(e.createdAt)), now);

  return {
    generatedAt: new Date(now).toISOString(),
    periodStart: new Date(start).toISOString(),
    periodEnd: new Date(now).toISOString(),
    greeting: `World briefing — ${new Date(now).toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "UTC" })}`,
    topDevelopments: diversify(ranked, 5).map(item),
    changes,
    comparison: [...counts.entries()]
      .map(([category, c]) => ({ category, label: CATEGORIES[category as keyof typeof CATEGORIES]?.layerLabel ?? category, ...c }))
      .sort((a, b) => b.today + b.yesterday - (a.today + a.yesterday)),
    sections: SECTIONS.map((s) => ({ id: s.id, title: s.title, items: diversify(ranked.filter(s.match), 4).map(item) })),
    whatToWatch: real
      .filter((e) => Date.parse(e.timestamp) > now || (e.resolvedAt !== null && Date.parse(e.resolvedAt) > now && e.importanceScore >= 30))
      .sort((a, b) => b.importanceScore - a.importanceScore)
      .slice(0, 6)
      .map(item),
    historyDays: Math.round(((now - oldest) / DAY) * 10) / 10,
    aiNarrative: null,
  };
}
