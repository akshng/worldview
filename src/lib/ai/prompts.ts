/** Prompts shared by every AI provider (hosted or local). */
import type { WorldEvent } from "@/types/events";
import type { DailyBriefing } from "@/lib/briefing";
import { EVENT_CATEGORIES } from "@/types/events";

export const INTERPRET_SYSTEM = `You are an analyst for a world-events monitoring application.
You receive a structured event record (already verified from its listed sources) and a few nearby/related events.
Write a brief interpretation (3–5 sentences, plain prose, no headings, no lists) of why this event may matter: plausible consequences, what to watch, and relevant context.
Rules:
- Do not restate the facts as if new, and do not invent facts, numbers, casualties, names or sources.
- Use hedged language ("may", "could", "if") for anything not in the record.
- If the record is too sparse to say anything useful, say so in one sentence.
- Related events are only spatially/temporally nearby; do not assume they are causally linked.`;

export const BRIEFING_SYSTEM = `You write a concise morning world briefing for a monitoring application.
You receive a JSON structure of events (already sourced and verified by the application) grouped into top developments, regions and things to watch.
Write 3–6 short paragraphs of plain prose (no markdown headings, no bullet lists).
Rules:
- Use ONLY events present in the JSON. Never add events, numbers, names, casualties or causes that are not in it.
- Mention whether items are new, developing or resolved when relevant.
- Say plainly when coverage is thin (e.g. few events in a region), rather than filling gaps.
- Treat machine-coded news items ("UNVERIFIED" status) with hedged language ("reports indicate").
- Do not speculate about consequences beyond brief, hedged context.`;

export const COMMAND_SYSTEM = `You convert a user's question about world events into search filters for a map application.
Categories: ${EVENT_CATEGORIES.join(", ")}.
Return only filters as JSON: categories (empty array = all), range ("1h", "6h", "24h", "7d" or null), minMagnitude (earthquakes, or null), place (a place NAME such as a country, a region like "Europe" or "Middle East", a US state or a city; or null), keywords (free text or null), and a one-sentence explanation of how you interpreted the question.
Never answer the question and never invent facts — the application looks up real events with these filters.`;

export function compactEvent(e: WorldEvent) {
  return {
    type: e.type,
    subtype: e.subtype,
    title: e.title,
    verified_summary: e.summary,
    location: e.locationName,
    country: e.countryName ?? e.country,
    timestamp: e.timestamp,
    status: e.status,
    importance: e.importanceScore,
    metrics: e.metrics,
    sources: e.sources.map((s) => s.sourceName),
  };
}

export function interpretPayload(event: WorldEvent, context: WorldEvent[]) {
  return `Event record (JSON):\n${JSON.stringify({ event: compactEvent(event), nearby_events: context.slice(0, 6).map(compactEvent) }, null, 2)}`;
}

export function briefingPayload(b: DailyBriefing, summaryChars = 400) {
  const compact = (items: DailyBriefing["topDevelopments"]) =>
    items.map((i) => ({
      change: i.change,
      type: i.event.type,
      title: i.event.title,
      verified_summary: i.event.summary.slice(0, summaryChars),
      where: i.event.countryName ?? i.event.locationName,
      when: i.event.timestamp,
      status: i.event.status,
      importance: i.event.importanceScore,
      sources: i.event.sourceCount,
    }));
  return `Briefing structure (JSON):\n${JSON.stringify({
    period: { start: b.periodStart, end: b.periodEnd },
    counts: b.changes,
    top_developments: compact(b.topDevelopments),
    sections: b.sections.filter((s) => s.items.length).map((s) => ({ section: s.title, items: compact(s.items) })),
    what_to_watch: compact(b.whatToWatch),
    category_counts_today_vs_yesterday: b.comparison,
  })}`;
}

export const MARKET_SYSTEM = `You write a short, factual market wrap for a world-events dashboard.
You receive JSON with current quotes (price, change, % change) and a list of world events that the application has linked to instruments by simple rules.
Write 2–4 short paragraphs of plain prose:
- Describe the largest moves across indices, rates, FX, commodities and crypto using ONLY the numbers given.
- Mention events only as context that coincides with moves ("…while reports of X…"). Never claim an event caused a move.
- Do NOT give investment advice, recommendations, price targets, predictions, or buy/sell/hold language.
- Yield changes are in basis points (bp); write them as "bp", never as percent.
- Keep it under 250 words. If data is missing or stale, say so briefly.`;

export function marketPayload(input: import("./types").MarketBriefInput) {
  const q = (list: import("@/lib/finance/types").Quote[]) =>
    list.filter((x) => x.price !== null).map((x) => ({ name: x.name, price: x.price, change: x.change, change_pct: x.changePct, unit: x.unit }));
  const g = input.snapshot.groups;
  return `Market data (JSON):\n${JSON.stringify({
    as_of: input.snapshot.generatedAt,
    indices: q(g.indices),
    // Yields are levels in percent; their change is given in basis points to avoid "%" confusion.
    rates: g.rates.filter((x) => x.price !== null).map((x) => ({ name: x.name, yield_percent: x.price, change_bp: x.change === null ? null : Math.round(x.change * 100) })),
    fx: q(g.fx),
    commodities: q(g.commodities),
    crypto: q(g.crypto),
    linked_events: input.movers.slice(0, 12),
  })}`;
}
