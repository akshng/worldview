/**
 * AI provider selection.
 *   AI_PROVIDER=local (default) — keyless on-device model (node-llama-cpp), downloads once
 *   AI_PROVIDER=anthropic       — hosted Claude (needs AI_API_KEY)
 *   AI_PROVIDER=none            — AI features off
 */
import "server-only";
import { env } from "@/lib/env";
import { AnthropicProvider, DEFAULT_ANTHROPIC_MODEL } from "./providers/anthropic";
import { DEFAULT_LOCAL_MODEL, LocalProvider, defaultModelsDir, type LocalModelState } from "./providers/local";
import type { AIProvider } from "./types";

export interface AIStatusInfo {
  enabled: boolean;
  provider: string | null;
  model: string | null;
  reason: string | null;
  /** Local model lifecycle (download/load progress) */
  local: LocalModelState | null;
}

let provider: AIProvider | null | undefined;

export function getAIProvider(): AIProvider | null {
  if (provider !== undefined) return provider;
  const e = env();
  if (e.AI_PROVIDER === "anthropic" && e.AI_API_KEY) provider = new AnthropicProvider(e.AI_API_KEY, e.AI_MODEL || DEFAULT_ANTHROPIC_MODEL);
  else if (e.AI_PROVIDER === "local") provider = new LocalProvider(e.AI_LOCAL_MODEL || DEFAULT_LOCAL_MODEL, defaultModelsDir(e.DATA_DIR));
  else provider = null;
  return provider;
}

export function getLocalProvider(): LocalProvider | null {
  const p = getAIProvider();
  return p instanceof LocalProvider ? p : null;
}

export function aiStatus(): AIStatusInfo {
  const e = env();
  const p = getAIProvider();
  if (p) return { enabled: true, provider: p.name, model: p.model, reason: null, local: p instanceof LocalProvider ? p.status() : null };
  return {
    enabled: false,
    provider: null,
    model: null,
    reason: e.AI_PROVIDER === "none" ? "AI is turned off (AI_PROVIDER=none)." : "AI_API_KEY is missing for the hosted provider.",
    local: null,
  };
}
