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

// ── 10-K filing analysis ────────────────────────────────────────────────────

const FILING_SECTION_FOCUS = {
  business: "what the company does: products/services, segments, customers, geographies, competition, employees, notable strategy statements",
  riskFactors: "the most material, company-specific risks (skip generic boilerplate that applies to any company); name each risk briefly with its specific driver",
  mdna: "management's discussion: drivers of revenue and margin changes, segment trends, liquidity and capital return, capital spending plans, guidance or outlook statements, anything management flags as new or changed",
  marketRisk: "market-risk exposures: interest rates, foreign currency, commodity or equity price exposure, hedging approach and sensitivity figures",
} as const;
export type FilingSectionKey = keyof typeof FILING_SECTION_FOCUS;

export const FILING_SECTION_TITLES: Record<FilingSectionKey, string> = {
  business: "Item 1 — Business",
  riskFactors: "Item 1A — Risk Factors",
  mdna: "Item 7 — Management's Discussion and Analysis",
  marketRisk: "Item 7A — Market Risk",
};

/** Map step: condense one chunk of a 10-K section into short factual notes. */
export function filingChunkSystem(section: FilingSectionKey) {
  return `You take notes on one excerpt of a company's annual report (Form 10-K), section "${FILING_SECTION_TITLES[section]}".
Write 4–8 terse bullet points ("- ") covering ${FILING_SECTION_FOCUS[section]}.
Rules:
- Use ONLY the excerpt. Never add facts, numbers or names from memory.
- Keep numbers exactly as written in the excerpt, with their units and periods.
- No opinions, no investment advice, no buy/sell language.
- If the excerpt is only a table of contents, legal boilerplate or cross-references, write "- (no substantive content)".`;
}

export const FILING_CONDENSE_SYSTEM = `You merge bullet-point notes taken from consecutive parts of one section of a company's Form 10-K.
Write at most 10 terse bullet points ("- ") that keep the most important, specific points; drop duplicates and "(no substantive content)" lines.
Use ONLY the notes; keep numbers exactly as written. No opinions or investment advice.`;

export const FILING_SYSTEM = `You write a structured analysis of a company's annual report (Form 10-K) for an information dashboard.
You receive (1) financial figures the application computed from the filing's XBRL data — current fiscal year vs prior year, already formatted — and (2) notes taken from the filing's own text sections (may be absent).
Return JSON with:
- businessSummary: 2–4 sentences on what the company does, from the Business notes. Empty string if there are no Business notes.
- keyFinancialChanges: 4–7 items describing the most important changes in the computed figures (cite the figures exactly as given).
- topRisks: up to 6 of the most material company-specific risks, each one sentence, from the Risk Factors notes. Empty array if there are no Risk Factors notes.
- outlook: up to 6 MD&A highlights or management outlook statements, from the MD&A / market-risk notes. Empty array if there are no such notes.
- notableChanges: up to 5 notable changes versus the prior year (from the figures and the notes).
- investorQuestions: 4–6 open questions an investor might ask management or research further.
Rules:
- Use ONLY the figures and notes provided. Never add numbers, events, products or names from memory.
- Do not recompute or round the figures differently; quote them as given.
- Information only: never recommend buying, selling or holding, never give price targets or valuations, never predict the share price.
- Use hedged, neutral language; each item is one or two plain sentences without markdown.`;

export function filingPayload(input: import("./types").FilingAnalysisInput, notes: Partial<Record<FilingSectionKey, string>>) {
  const parts = [
    `Company: ${input.company}\nReport: ${input.form}, ${input.period}`,
    `Computed financial figures (JSON; current = this fiscal year, prior = previous fiscal year):\n${JSON.stringify(input.facts)}`,
  ];
  for (const k of Object.keys(FILING_SECTION_TITLES) as FilingSectionKey[]) {
    if (notes[k]?.trim()) parts.push(`Notes from ${FILING_SECTION_TITLES[k]}:\n${notes[k]!.trim()}`);
  }
  if (!Object.values(notes).some((n) => n?.trim())) parts.push("The filing's text sections were not available; base the analysis on the figures only.");
  return parts.join("\n\n");
}

import { setupFacts } from "@/lib/finance/setups";

export const SETUP_SYSTEM = `You review a stock that a rule-based price screen flagged. You receive JSON facts computed by the application.
Write exactly three short sections in plain text, each starting with its label:
What stands out: 1–2 sentences on what the rules found, using ONLY the numbers given.
Why it could be cheap for a reason: 2–3 concrete risks or alternative explanations (falling prices often reflect real problems such as weaker earnings, guidance cuts, lawsuits, sector rotation). Use rule_risks if present. Insider selling is often routine (taxes, planned sales), so do not treat it as a strong signal either way.
Check before acting: 2–3 specific things a person should verify (latest earnings and guidance, recent news, valuation versus peers, position size and risk tolerance).
Rules: no buy/sell/hold language, no price targets, no predictions, no certainty, and never reassure that a drop is "not fundamental" — you cannot know. Never mention JSON field names. Do not invent facts, news, or numbers not in the JSON. Under 140 words.`;

export function setupPayload(s: import("@/lib/finance/setups").Setup) {
  return `Flagged stock (JSON):\n${JSON.stringify(setupFacts(s))}`;
}
