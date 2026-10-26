/**
 * Local, keyless AI: an open-weights model (Apache-2.0) run on this machine with
 * llama.cpp via node-llama-cpp (Metal on Apple Silicon). No account, no API key,
 * no data leaves the computer. The model downloads once (≈2.5 GB) on first use
 * or via `npm run ai:setup`.
 */
import "server-only";
import path from "node:path";
import { existsSync, readdirSync } from "node:fs";
import type { WorldEvent } from "@/types/events";
import type { DailyBriefing } from "@/lib/briefing";
import { EVENT_CATEGORIES } from "@/types/events";
import { CommandIntentSchema, FilingSectionsSchema, type AIProvider, type CommandIntent, type FilingAnalysisInput, type FilingSections, type MarketBriefInput } from "../types";
import { BRIEFING_SYSTEM, COMMAND_SYSTEM, INTERPRET_SYSTEM, MARKET_SYSTEM, SETUP_SYSTEM, briefingPayload, interpretPayload, marketPayload, setupPayload } from "../prompts";
import { runFilingAnalysis } from "../filing";
import type { LocalSession } from "@/lib/analyst/llm";

/** Gemma 4 E2B (Apache-2.0): ~2.5× faster than Qwen3-4B on this app's tasks at similar quality (benchmarked on an M4). */
export const DEFAULT_LOCAL_MODEL = "hf:unsloth/gemma-4-E2B-it-GGUF:Q4_K_M";
const CONTEXT_SIZE = 12_288;

export type LocalModelState =
  | { state: "not-downloaded" }
  | { state: "downloaded" }
  | { state: "downloading"; downloadedBytes: number; totalBytes: number }
  | { state: "loading" }
  | { state: "ready" }
  | { state: "error"; message: string };

type Runtime = {
  llama: Awaited<ReturnType<typeof import("node-llama-cpp").getLlama>>;
  model: Awaited<ReturnType<Runtime["llama"]["loadModel"]>>;
  context: Awaited<ReturnType<Runtime["model"]["createContext"]>>;
};

const g = globalThis as unknown as {
  __worldviewLocalAI?: { status: LocalModelState; runtime: Promise<Runtime> | null; queue: Promise<unknown>; idleTimer: NodeJS.Timeout | null; busy: number; unloadWhenIdle?: boolean };
};
const shared = (g.__worldviewLocalAI ??= { status: { state: "not-downloaded" }, runtime: null, queue: Promise.resolve(), idleTimer: null, busy: 0 });

const COMMAND_JSON_SCHEMA = {
  type: "object",
  properties: {
    categories: { type: "array", items: { enum: [...EVENT_CATEGORIES] } },
    range: { oneOf: [{ enum: ["1h", "6h", "24h", "7d"] }, { type: "null" }] },
    minMagnitude: { oneOf: [{ type: "number" }, { type: "null" }] },
    place: { oneOf: [{ type: "string" }, { type: "null" }] },
    keywords: { oneOf: [{ type: "string" }, { type: "null" }] },
    explanation: { type: "string" },
  },
} as const;

const strings = (minItems: number, maxItems: number) => ({ type: "array", items: { type: "string" }, minItems, maxItems }) as const;
const FILING_JSON_SCHEMA = {
  type: "object",
  properties: {
    businessSummary: { type: "string" },
    keyFinancialChanges: strings(3, 7),
    topRisks: strings(0, 6),
    outlook: strings(0, 6),
    notableChanges: strings(2, 5),
    investorQuestions: strings(3, 6),
  },
} as const;

export class LocalProvider implements AIProvider {
  readonly name = "local";

  constructor(
    private readonly modelUri: string,
    private readonly modelsDir: string,
    /** Unload the model after this many idle minutes (0 = keep loaded). */
    private readonly idleUnloadMinutes = 5,
  ) {}

  /**
   * Free the model's memory/GPU. It reloads automatically on the next AI request.
   * If a request is running or queued, the unload happens as soon as the last one
   * finishes — disposing mid-request crashes it ("Object is disposed").
   */
  async unload(): Promise<boolean> {
    if (shared.idleTimer) clearTimeout(shared.idleTimer);
    shared.idleTimer = null;
    if (shared.busy > 0) {
      shared.unloadWhenIdle = true;
      return Boolean(shared.runtime);
    }
    shared.unloadWhenIdle = false;
    const pending = shared.runtime;
    if (!pending) return false;
    shared.runtime = null;
    try {
      const rt = await pending;
      await rt.context.dispose();
      await rt.model.dispose();
      await rt.llama.dispose();
    } catch {
      /* already gone */
    }
    shared.status = { state: this.isDownloaded() ? "downloaded" : "not-downloaded" };
    return true;
  }

  private scheduleIdleUnload() {
    if (!this.idleUnloadMinutes) return;
    if (shared.idleTimer) clearTimeout(shared.idleTimer);
    shared.idleTimer = setTimeout(() => {
      if (shared.busy === 0) void this.unload();
    }, this.idleUnloadMinutes * 60_000);
    shared.idleTimer.unref?.();
  }

  get model(): string {
    return this.modelUri.replace(/^hf:/, "").split("/").pop() ?? this.modelUri;
  }

  /** Whether a model file already exists locally (no network). */
  isDownloaded(): boolean {
    if (!existsSync(this.modelsDir)) return false;
    const quant = this.modelUri.split(":").pop()!.toLowerCase();
    const repo = this.modelUri.replace(/^hf:/, "").split(":")[0].split("/").pop()!.toLowerCase().replace(/-gguf$/, "");
    return readdirSync(this.modelsDir).some((f) => f.toLowerCase().endsWith(".gguf") && f.toLowerCase().includes(quant) && f.toLowerCase().includes(repo.split("-")[0]));
  }

  status(): LocalModelState {
    if (shared.status.state === "not-downloaded" && this.isDownloaded()) return { state: "downloaded" };
    return shared.status;
  }

  /** Download (if needed) and load the model. Safe to call repeatedly. */
  ensureReady(): Promise<Runtime> {
    if (!shared.runtime) {
      shared.runtime = (async () => {
        const { getLlama, resolveModelFile } = await import("node-llama-cpp");
        const modelPath = await resolveModelFile(this.modelUri, {
          directory: this.modelsDir,
          cli: false,
          onProgress: ({ downloadedSize, totalSize }) => {
            shared.status = { state: "downloading", downloadedBytes: downloadedSize, totalBytes: totalSize };
          },
        });
        shared.status = { state: "loading" };
        const llama = await getLlama();
        const model = await llama.loadModel({ modelPath });
        const context = await model.createContext({ contextSize: CONTEXT_SIZE });
        shared.status = { state: "ready" };
        return { llama, model, context };
      })().catch((err) => {
        shared.status = { state: "error", message: err instanceof Error ? err.message : String(err) };
        shared.runtime = null;
        throw err;
      });
    }
    return shared.runtime;
  }

  /** Run one chat completion. Calls are serialised: one local context, one request at a time. */
  private run<T>(fn: (rt: Runtime, session: InstanceType<typeof import("node-llama-cpp").LlamaChatSession>) => Promise<T>, systemPrompt: string): Promise<T> {
    shared.busy++;
    shared.unloadWhenIdle = false; // new work cancels a pending "unload when idle"
    if (shared.idleTimer) clearTimeout(shared.idleTimer);
    const job = shared.queue.then(async () => {
      const rt = await this.ensureReady();
      const { LlamaChatSession, Gemma4ChatWrapper } = await import("node-llama-cpp");
      let sequence;
      try {
        sequence = rt.context.getSequence();
      } catch {
        // Some models (Gemma 4) don't hand a freed sequence back; start a fresh context.
        await rt.context.dispose().catch(() => undefined);
        rt.context = await rt.model.createContext({ contextSize: CONTEXT_SIZE });
        sequence = rt.context.getSequence();
      }
      try {
        // Gemma 4 thinks out loud by default; these tasks want the answer only (faster, less battery).
        const chatWrapper = /gemma-4/i.test(this.modelUri) ? new Gemma4ChatWrapper({ reasoning: false }) : undefined;
        const session = new LlamaChatSession({ contextSequence: sequence, systemPrompt, ...(chatWrapper ? { chatWrapper } : {}) });
        return await fn(rt, session);
      } finally {
        sequence.dispose();
      }
    });
    shared.queue = job.catch(() => undefined);
    void job.finally(() => {
      shared.busy--;
      if (shared.busy === 0 && shared.unloadWhenIdle) void this.unload();
      else this.scheduleIdleUnload();
    }).catch(() => undefined);
    return job;
  }

  async interpretEvent(event: WorldEvent, context: WorldEvent[]): Promise<string> {
    const text = await this.run((_, s) => s.prompt(interpretPayload(event, context), { maxTokens: 400, temperature: 0.3 }), INTERPRET_SYSTEM);
    if (!text.trim()) throw new Error("The local model returned no text.");
    return text.trim().slice(0, 4000);
  }

  async writeBriefing(briefing: DailyBriefing): Promise<string> {
    const text = await this.run((_, s) => s.prompt(briefingPayload(briefing, 220), { maxTokens: 900, temperature: 0.3 }), BRIEFING_SYSTEM);
    if (!text.trim()) throw new Error("The local model returned no text.");
    return text.trim().slice(0, 8000);
  }

  async writeSetupNote(setup: import("@/lib/finance/setups").Setup): Promise<string> {
    const text = await this.run((_, s) => s.prompt(setupPayload(setup), { maxTokens: 500, temperature: 0.2 }), SETUP_SYSTEM);
    if (!text.trim()) throw new Error("The local model returned no text.");
    return text.trim().slice(0, 1500);
  }

  async writeMarketBrief(input: MarketBriefInput): Promise<string> {
    const text = await this.run((_, s) => s.prompt(marketPayload(input), { maxTokens: 900, temperature: 0.2 }), MARKET_SYSTEM);
    if (!text.trim()) throw new Error("The local model returned no text.");
    return text.trim().slice(0, 5000);
  }

  /**
   * 10-K analysis within the 12k-token context: filing text is summarised in
   * ~4k-token chunks first, then one grammar-constrained call (~7k tokens in,
   * <=1.8k out) writes the structured sections.
   */
  async analyzeFiling(input: FilingAnalysisInput): Promise<FilingSections> {
    return runFilingAnalysis(
      {
        chunkChars: 16_000,
        sectionBudget: { business: 4_000, riskFactors: 7_000, mdna: 7_000, marketRisk: 2_500 },
        maxSectionChars: 120_000,
        complete: async (system, user, maxTokens) => {
          const text = await this.run((_, s) => s.prompt(user, { maxTokens, temperature: 0.1 }), system);
          return text.trim();
        },
        structured: (system, user) =>
          this.run(async (rt, s) => {
            const grammar = await rt.llama.createGrammarForJsonSchema(FILING_JSON_SCHEMA as never);
            const out = await s.prompt(user, { grammar, maxTokens: 1800, temperature: 0.2 });
            return FilingSectionsSchema.parse(grammar.parse(out));
          }, system),
      },
      input,
    );
  }

  /**
   * One serialised chat session for the AI analyst: successive prompts share the
   * session (and its KV cache), so planning steps only evaluate new tokens.
   */
  chatSession<T>(systemPrompt: string, fn: (s: LocalSession) => Promise<T>): Promise<T> {
    return this.run(async (rt, session) => {
      const grammars = new Map<object, Awaited<ReturnType<Runtime["llama"]["createGrammarForJsonSchema"]>>>();
      return fn({
        json: async (prompt, schema, maxTokens) => {
          let grammar = grammars.get(schema);
          if (!grammar) grammars.set(schema, (grammar = await rt.llama.createGrammarForJsonSchema(schema as never)));
          return session.prompt(prompt, { grammar, maxTokens, temperature: 0 });
        },
        text: async (prompt, maxTokens, onDelta) => (await session.prompt(prompt, { maxTokens, temperature: 0.3, onTextChunk: onDelta })).trim(),
      });
    }, systemPrompt);
  }

  async parseCommand(query: string): Promise<CommandIntent> {
    return this.run(async (rt, s) => {
      // Grammar-constrained decoding: output is guaranteed to match the JSON schema.
      const grammar = await rt.llama.createGrammarForJsonSchema(COMMAND_JSON_SCHEMA as never);
      const out = await s.prompt(query.slice(0, 500), { grammar, maxTokens: 300, temperature: 0 });
      return CommandIntentSchema.parse(grammar.parse(out));
    }, COMMAND_SYSTEM);
  }
}

export function defaultModelsDir(dataDir: string) {
  return path.resolve(process.cwd(), dataDir, "models");
}
