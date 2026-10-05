/**
 * AI service contract. AI is optional: when unconfigured, the app runs fully on
 * deterministic logic. AI output is ALWAYS stored/displayed as interpretation
 * (`WorldEvent.aiInterpretation`), never merged into verified fields.
 *
 * Pipeline principle: RAW DATA → STRUCTURED EVENT → AI INTERPRETATION.
 */
import { z } from "zod";
import { EVENT_CATEGORIES, type EventCategory, type WorldEvent } from "@/types/events";
import type { DailyBriefing } from "@/lib/briefing";

/**
 * Structured interpretation of a natural-language command. The model only
 * returns filters and a place *name*; the app resolves places with its own
 * gazetteer, so the AI never supplies coordinates or facts.
 */
export const CommandIntentSchema = z.object({
  categories: z.array(z.enum(EVENT_CATEGORIES)),
  range: z.enum(["1h", "6h", "24h", "7d"]).nullable(),
  minMagnitude: z.number().nullable(),
  place: z.string().nullable(),
  keywords: z.string().nullable(),
  explanation: z.string(),
});
export type CommandIntent = z.infer<typeof CommandIntentSchema>;

export interface AIProvider {
  readonly name: string;
  readonly model: string;
  /** "Why this may matter" style interpretation of a structured event. */
  interpretEvent(event: WorldEvent, context: WorldEvent[]): Promise<string>;
  /** Narrative for the daily briefing, written only from the briefing structure. */
  writeBriefing(briefing: DailyBriefing): Promise<string>;
  /** Natural-language query → structured filters (no facts). */
  parseCommand(query: string): Promise<CommandIntent>;
}

/**
 * Planned capabilities (not yet implemented — see docs/ARCHITECTURE.md → AI):
 *   summarizeEvent, classifyEvent, extractLocation, extractEntities, clusterEvents,
 *   calculateImportance, generateCountryBriefing, generateWorldBriefing.
 * (generateDailyBriefing → AIProvider.writeBriefing)
 * Each should take structured events as input and return clearly-labelled output.
 */
export interface FutureAICapabilities {
  summarizeEvent(event: WorldEvent): Promise<string>;
  classifyEvent(text: string): Promise<{ type: EventCategory; confidence: number }>;
  extractLocation(text: string): Promise<{ name: string; lat: number; lon: number } | null>;
  extractEntities(text: string): Promise<Array<{ type: string; name: string }>>;
  clusterEvents(events: WorldEvent[]): Promise<string[][]>;
  calculateImportance(event: WorldEvent): Promise<number>;
  generateCountryBriefing(country: string, events: WorldEvent[]): Promise<string>;
  generateWorldBriefing(events: WorldEvent[]): Promise<string>;
  generateDailyBriefing(today: WorldEvent[], yesterday: WorldEvent[]): Promise<string>;
}

export interface AIStatus {
  enabled: boolean;
  provider: string | null;
  model: string | null;
  reason: string | null;
}
