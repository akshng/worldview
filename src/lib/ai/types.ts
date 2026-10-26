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
import type { MarketSnapshot, ExposureLink } from "@/lib/finance/types";

export interface MarketBriefInput {
  snapshot: MarketSnapshot;
  movers: Array<{ title: string; status: string; importance: number; where: string | null; exposure: ExposureLink[] }>;
}

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

/**
 * AI-written sections of a 10-K analysis. Written ONLY from the numbers the app
 * computed from XBRL and the text extracted from the filing itself.
 */
export const FilingSectionsSchema = z.object({
  businessSummary: z.string(),
  keyFinancialChanges: z.array(z.string()),
  topRisks: z.array(z.string()),
  outlook: z.array(z.string()),
  notableChanges: z.array(z.string()),
  investorQuestions: z.array(z.string()),
});
export type FilingSections = z.infer<typeof FilingSectionsSchema>;

/** One computed figure handed to the model, already formatted by the app. */
export interface FilingFactForAI {
  label: string;
  current: string;
  prior: string;
  change: string;
}

export interface FilingAnalysisInput {
  company: string;
  form: string;
  /** e.g. "fiscal year ended 2025-09-27" */
  period: string;
  facts: FilingFactForAI[];
  /** Extracted filing text per section; absent when the document couldn't be read */
  text: { business?: string; riskFactors?: string; mdna?: string; marketRisk?: string } | null;
  /** Called with human-readable progress ("Summarizing risk factors (2/5)…") */
  onProgress?: (step: string) => void;
}

export interface AIProvider {
  readonly name: string;
  readonly model: string;
  /** "Why this may matter" style interpretation of a structured event. */
  interpretEvent(event: WorldEvent, context: WorldEvent[]): Promise<string>;
  /** Narrative for the daily briefing, written only from the briefing structure. */
  writeBriefing(briefing: DailyBriefing): Promise<string>;
  /** Natural-language query → structured filters (no facts). */
  parseCommand(query: string): Promise<CommandIntent>;
  /** Descriptive summary of market moves alongside world events. Never advice. */
  writeMarketBrief(input: MarketBriefInput): Promise<string>;
  /** Structured 10-K analysis from computed facts + extracted filing text (map-reduce for long text). Never advice. */
  analyzeFiling(input: FilingAnalysisInput): Promise<FilingSections>;
  /** Balanced note (what stands out / risks / what to check) on a rule-flagged stock. Never advice. */
  writeSetupNote(setup: import("@/lib/finance/setups").Setup): Promise<string>;
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
