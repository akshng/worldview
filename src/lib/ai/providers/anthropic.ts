import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { WorldEvent } from "@/types/events";
import type { DailyBriefing } from "@/lib/briefing";
import { CommandIntentSchema, FilingSectionsSchema, type AIProvider, type CommandIntent, type FilingAnalysisInput, type FilingSections, type MarketBriefInput } from "../types";
import { BRIEFING_SYSTEM, COMMAND_SYSTEM, INTERPRET_SYSTEM, MARKET_SYSTEM, briefingPayload, interpretPayload, marketPayload } from "../prompts";
import { runFilingAnalysis } from "../filing";
import type { NativeHistoryItem, NativeTurn } from "@/lib/analyst/llm";
import { inputSchema, type ToolDef } from "@/lib/analyst/tools";

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

  /** One analyst turn with native tool use. Assistant content is replayed unchanged (thinking blocks included). */
  async analystTurn(input: { system: string; history: NativeHistoryItem[]; tools: ToolDef[]; allowTools: boolean }): Promise<NativeTurn> {
    const messages: Anthropic.Beta.BetaMessageParam[] = input.history.map((h) =>
      h.role === "user"
        ? { role: "user", content: h.text }
        : h.role === "assistant"
          ? { role: "assistant", content: h.turn.raw as Anthropic.Beta.BetaContentBlockParam[] }
          : { role: "user", content: h.results.map((r) => ({ type: "tool_result" as const, tool_use_id: r.id, content: r.content, is_error: r.isError || undefined })) },
    );
    const response = await this.client.beta.messages.create({
      model: this.model,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium" },
      system: input.system,
      tools: input.tools.map((t) => ({ name: t.name, description: t.description, input_schema: inputSchema(t) })),
      tool_choice: input.allowTools ? { type: "auto" } : { type: "none" },
      messages,
    });
    const text = response.content
      .filter((c): c is Anthropic.Beta.BetaTextBlock => c.type === "text")
      .map((c) => c.text)
      .join("\n")
      .trim();
    const calls = response.content
      .filter((c): c is Anthropic.Beta.BetaToolUseBlock => c.type === "tool_use")
      .map((c) => ({ id: c.id, name: c.name, input: c.input }));
    const stop = response.stop_reason === "tool_use" || response.stop_reason === "end_turn" || response.stop_reason === "refusal" || response.stop_reason === "max_tokens" ? response.stop_reason : "other";
    return { text, calls, stop, raw: response.content };
  }

  /** 10-K analysis. The hosted model's large context usually takes whole sections verbatim (no map step). */
  async analyzeFiling(input: FilingAnalysisInput): Promise<FilingSections> {
    return runFilingAnalysis(
      {
        chunkChars: 120_000,
        sectionBudget: { business: 60_000, riskFactors: 120_000, mdna: 120_000, marketRisk: 20_000 },
        maxSectionChars: 150_000,
        complete: async (system, user) => {
          const response = await this.client.beta.messages.create({
            model: this.model,
            max_tokens: 16000,
            betas: ["server-side-fallback-2026-07-01"],
            fallbacks: "default",
            output_config: { effort: "low" },
            system,
            messages: [{ role: "user", content: user }],
          });
          if (response.stop_reason === "refusal") throw new Error("The AI model declined to summarise this filing.");
          return response.content
            .filter((c): c is Anthropic.Beta.BetaTextBlock => c.type === "text")
            .map((c) => c.text)
            .join("\n")
            .trim();
        },
        structured: async (system, user) => {
          const response = await this.client.beta.messages.parse({
            model: this.model,
            max_tokens: 16000,
            betas: ["server-side-fallback-2026-07-01"],
            fallbacks: "default",
            output_config: { effort: "medium", format: betaZodOutputFormat(FilingSectionsSchema) },
            system,
            messages: [{ role: "user", content: user }],
          });
          if (response.stop_reason === "refusal") throw new Error("The AI model declined to analyse this filing.");
          if (!response.parsed_output) throw new Error("The AI model returned an unparseable analysis.");
          return FilingSectionsSchema.parse(response.parsed_output);
        },
      },
      input,
    );
  }
}
