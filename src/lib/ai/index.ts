import "server-only";
import { env } from "@/lib/env";
import { AnthropicProvider, DEFAULT_ANTHROPIC_MODEL } from "./providers/anthropic";
import type { AIProvider, AIStatus } from "./types";

let provider: AIProvider | null | undefined;

/** Returns the configured AI provider, or null when AI is not configured. */
export function getAIProvider(): AIProvider | null {
  if (provider !== undefined) return provider;
  const e = env();
  if (e.AI_PROVIDER === "anthropic" && e.AI_API_KEY) {
    provider = new AnthropicProvider(e.AI_API_KEY, e.AI_MODEL || DEFAULT_ANTHROPIC_MODEL);
  } else {
    provider = null;
  }
  return provider;
}

export function aiStatus(): AIStatus {
  const e = env();
  const p = getAIProvider();
  if (p) return { enabled: true, provider: p.name, model: p.model, reason: null };
  return {
    enabled: false,
    provider: null,
    model: null,
    reason:
      e.AI_PROVIDER === "none"
        ? "AI is not configured (set AI_PROVIDER and AI_API_KEY)."
        : "AI_API_KEY is missing.",
  };
}
