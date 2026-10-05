import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { WorldEvent } from "@/types/events";
import type { DailyBriefing } from "@/lib/briefing";
import { CommandIntentSchema, type AIProvider, type CommandIntent, type MarketBriefInput } from "../types";
import { BRIEFING_SYSTEM, COMMAND_SYSTEM, INTERPRET_SYSTEM, MARKET_SYSTEM, briefingPayload, interpretPayload, marketPayload } from "../prompts";

export const DEFAULT_ANTHROPIC_MODEL = "claude-opus-5-5";

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
    const response = await this.client.beta.messages.create({
      model: this.model,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low" },
      system: INTERPRET_SYSTEM,
      messages: [{ role: "user", content: interpretPayload(event, context) }],
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
    const response = await this.client.beta.messages.create({
      model: this.model,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium" },
      system: BRIEFING_SYSTEM,
      messages: [{ role: "user", content: briefingPayload(b) }],
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

  async writeMarketBrief(input: MarketBriefInput): Promise<string> {
    const response = await this.client.beta.messages.create({
      model: this.model,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low" },
      system: MARKET_SYSTEM,
      messages: [{ role: "user", content: marketPayload(input) }],
    });
    if (response.stop_reason === "refusal") throw new Error("The AI model declined to write this summary.");
    const text = response.content
      .filter((c): c is Anthropic.Beta.BetaTextBlock => c.type === "text")
      .map((c) => c.text)
      .join("\n")
      .trim();
    if (!text) throw new Error("The AI model returned no text.");
    return text.slice(0, 5000);
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
