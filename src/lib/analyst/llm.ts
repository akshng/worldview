/** Model-facing interfaces the analyst loop runs on (implemented by the AI providers). */
import type { ToolDef } from "./tools";

export interface NativeToolCall {
  id: string;
  name: string;
  input: unknown;
}

/** One assistant turn from a model with native tool use. */
export interface NativeTurn {
  text: string;
  calls: NativeToolCall[];
  stop: "tool_use" | "end_turn" | "refusal" | "max_tokens" | "other";
  /** Provider-specific assistant content, replayed unchanged on the next turn */
  raw: unknown;
}

export type NativeHistoryItem =
  | { role: "user"; text: string }
  | { role: "assistant"; turn: NativeTurn }
  | { role: "tool_results"; results: Array<{ id: string; content: string; isError: boolean }> };

/** Hosted model with native tool calling (Anthropic). */
export interface NativeLLM {
  kind: "native";
  provider: string;
  model: string;
  turn(input: { system: string; history: NativeHistoryItem[]; tools: ToolDef[]; allowTools: boolean }): Promise<NativeTurn>;
}

/** A stateful chat on the local model: successive prompts reuse the KV cache. */
export interface LocalSession {
  /** Grammar-constrained JSON completion; returns the raw JSON text */
  json(prompt: string, schema: object, maxTokens: number): Promise<string>;
  /** Free-text completion, streamed through onDelta */
  text(prompt: string, maxTokens: number, onDelta?: (chunk: string) => void): Promise<string>;
}

/** Local model: JSON protocol (grammar) instead of native tool use. */
export interface JsonLLM {
  kind: "json";
  provider: string;
  model: string;
  /** Run `fn` inside one serialised session with this system prompt. */
  session<T>(system: string, fn: (s: LocalSession) => Promise<T>): Promise<T>;
}

export type AnalystLLM = NativeLLM | JsonLLM;
