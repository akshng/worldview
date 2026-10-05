import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { WorldEvent } from "@/types/events";
import type { DailyBriefing } from "@/lib/briefing";
import { CommandIntentSchema, type AIProvider, type CommandIntent } from "../types";

export const DEFAULT_ANTHROPIC_MODEL = "claude-opus-5-5";

const SYSTEM = `You are an analyst for a world-events monitoring application.
You receive a structured event record (already verified from its listed sources) and a few nearby/related events.
Write a brief interpretation (3–5 sentences, plain prose, no headings, no lists) of why this event may matter: plausible consequences, what to watch, and relevant context.
Rules:
- Do not restate the facts as if new, and do not invent facts, numbers, casualties, names or sources.
- Use hedged language ("may", "could", "if") for anything not in the record.
- If the record is too sparse to say anything useful, say so in one sentence.
- Related events are only spatially/temporally nearby; do not assume they are causally linked.`;

function compactEvent(e: WorldEvent) {
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

const BRIEFING_SYSTEM = `You write a concise morning world briefing for a monitoring application.
You receive a JSON structure of events (already sourced and verified by the application) grouped into top developments, regions and things to watch.
Write 3–6 short paragraphs of plain prose (no markdown headings, no bullet lists).
Rules:
- Use ONLY events present in the JSON. Never add events, numbers, names, casualties or causes that are not in it.
- Mention whether items are new, developing or resolved when relevant.
- Say plainly when coverage is thin (e.g. few events in a region), rather than filling gaps.
- Treat machine-coded news items ("Unverified" status) with hedged language ("reports indicate").
- Do not speculate about consequences beyond brief, hedged context.`;

const COMMAND_SYSTEM = `You convert a user's question about world events into search filters for a map application.
Categories: ${"NEWS, POLITICS, CONFLICT, PROTEST, DISASTER, EARTHQUAKE, WEATHER, FIRE, FLOOD, VOLCANO, SPACE, SCIENCE, TECHNOLOGY, BUSINESS, MARKETS, AVIATION, MARITIME, INFRASTRUCTURE, OTHER"}.
Return only filters: categories (empty = all), time range (1h/6h/24h/7d or null), minimum earthquake magnitude, a place NAME (country, region like "Europe"/"Middle East", state or city) or null, optional free-text keywords, and a one-sentence explanation of how you interpreted the question.
Never answer the question and never invent facts — the application will look up real events with these filters.`;

export class AnthropicProvider implements AIProvider {
  readonly name = "anthropic";
  private client: Anthropic;

  constructor(
    apiKey: string,
    readonly model: string = DEFAULT_ANTHROPIC_MODEL,
  ) {
    this.client = new Anthropic({ apiKey, timeout: 120_000, maxRetries: 2 });
  }

  async interpretEvent(event: WorldEvent, context: WorldEvent[]): Promise<string> {
    const payload = { event: compactEvent(event), nearby_events: context.slice(0, 6).map(compactEvent) };
    const response = await this.client.beta.messages.create({
      model: this.model,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low" },
      system: SYSTEM,
      messages: [{ role: "user", content: `Event record (JSON):\n${JSON.stringify(payload, null, 2)}` }],
    });
    if (response.stop_reason === "refusal") throw new Error("The AI model declined to interpret this event.");
    const text = response.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    if (!text) throw new Error("The AI model returned no text.");
    return text.slice(0, 4000);
  }

  async writeBriefing(b: DailyBriefing): Promise<string> {
    const compact = (items: DailyBriefing["topDevelopments"]) =>
      items.map((i) => ({
        change: i.change,
        type: i.event.type,
        title: i.event.title,
        verified_summary: i.event.summary,
        where: i.event.countryName ?? i.event.locationName,
        when: i.event.timestamp,
        status: i.event.status,
        importance: i.event.importanceScore,
        sources: i.event.sourceCount,
      }));
    const payload = {
      period: { start: b.periodStart, end: b.periodEnd },
      counts: b.changes,
      top_developments: compact(b.topDevelopments),
      sections: b.sections.filter((s) => s.items.length).map((s) => ({ section: s.title, items: compact(s.items) })),
      what_to_watch: compact(b.whatToWatch),
      category_counts_today_vs_yesterday: b.comparison,
    };
    const response = await this.client.beta.messages.create({
      model: this.model,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium" },
      system: BRIEFING_SYSTEM,
      messages: [{ role: "user", content: `Briefing structure (JSON):\n${JSON.stringify(payload)}` }],
    });
    if (response.stop_reason === "refusal") throw new Error("The AI model declined to write this briefing.");
    const text = response.content
      .filter((c): c is Anthropic.Beta.BetaTextBlock => c.type === "text")
      .map((c) => c.text)
      .join("\n")
      .trim();
    if (!text) throw new Error("The AI model returned no text.");
    return text.slice(0, 8000);
  }

  async parseCommand(query: string): Promise<CommandIntent> {
    const response = await this.client.beta.messages.parse({
      model: this.model,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low", format: betaZodOutputFormat(CommandIntentSchema) },
      system: COMMAND_SYSTEM,
      messages: [{ role: "user", content: query.slice(0, 500) }],
    });
    if (response.stop_reason === "refusal") throw new Error("The AI model declined to interpret this query.");
    if (!response.parsed_output) throw new Error("The AI model returned an unparseable interpretation.");
    return CommandIntentSchema.parse(response.parsed_output);
  }
}
