/**
 * Server glue for the analyst: picks the model adapter, serialises runs (one at
 * a time, small wait queue) and rate-limits per client, and streams NDJSON.
 */
import "server-only";
import { getAIProvider } from "@/lib/ai";
import { AnthropicProvider } from "@/lib/ai/providers/anthropic";
import { LocalProvider } from "@/lib/ai/providers/local";
import { env } from "@/lib/env";
import { AnalystAborted, runAnalyst, type AnalystRequest } from "./agent";
import { realDeps } from "./deps";
import type { AnalystLLM } from "./llm";
import type { AnalystStreamEvent } from "./types";

export function getAnalystLLM(): AnalystLLM | null {
  const p = getAIProvider();
  if (p instanceof AnthropicProvider) return { kind: "native", provider: p.name, model: p.model, turn: (i) => p.analystTurn(i) };
  if (p instanceof LocalProvider) return { kind: "json", provider: p.name, model: p.model, session: (system, fn) => p.chatSession(system, fn) };
  return null;
}

/** Local model default: routed (deterministic tools, model writes) unless ANALYST_LOCAL_MODE=agent. */
export const localMode = (): "agent" | "routed" => env().ANALYST_LOCAL_MODE;

// ─── Serialisation + rate limit ──────────────────────────────────────────────

const MAX_WAITING = 2;
const RATE_WINDOW_MS = 10 * 60_000;
const RATE_MAX = 12;
const MAX_KEYS = 256;

const g = globalThis as unknown as { __worldviewAnalyst?: { tail: Promise<unknown>; waiting: number; running: boolean; hits: Map<string, number[]> } };
const state = (g.__worldviewAnalyst ??= { tail: Promise.resolve(), waiting: 0, running: false, hits: new Map() });

/**
 * Rate-limit bucket for a request: always the one local key. The server binds to 127.0.0.1
 * with no proxy in front, so X-Forwarded-For is caller-controlled (trusting it would let a
 * client mint fresh buckets) and req.url's host is the bind address, not the caller.
 */
export function clientKey(req?: Request): string {
  void req;
  return "local";
}

/** Returns seconds to wait when over the limit, else null (and records the hit). */
export function rateLimit(key: string, now = Date.now()): number | null {
  const hits = (state.hits.get(key) ?? []).filter((t: number) => now - t < RATE_WINDOW_MS);
  if (hits.length >= RATE_MAX) return Math.ceil((hits[0] + RATE_WINDOW_MS - now) / 1000);
  hits.push(now);
  // Bounded even if a caller passes arbitrary keys: drop the oldest bucket beyond the cap.
  state.hits.delete(key);
  state.hits.set(key, hits);
  while (state.hits.size > MAX_KEYS) state.hits.delete(state.hits.keys().next().value!);
  return null;
}

export const queueFull = () => state.waiting >= MAX_WAITING;

/** Run analyst jobs strictly one after another. */
function serialise<T>(job: () => Promise<T>): Promise<T> {
  state.waiting++;
  const run = state.tail.then(async () => {
    state.waiting--;
    state.running = true;
    try {
      return await job();
    } finally {
      state.running = false;
    }
  });
  state.tail = run.catch(() => undefined);
  return run;
}

/** Stream a run as NDJSON (one AnalystStreamEvent per line). */
export function streamAnalyst(req: AnalystRequest, signal: AbortSignal): Response {
  const llm = getAnalystLLM()!;
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const send = (e: AnalystStreamEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(e)}\n`));
        } catch {
          closed = true;
        }
      };
      if (state.running || state.waiting > 0) send({ type: "status", text: "Waiting for the model (another analyst request is running)…" });
      const heartbeat = setInterval(() => send({ type: "status", text: "" }), 15_000);
      serialise(() => runAnalyst(req, { llm, deps: realDeps, emit: send, localMode: localMode(), signal }))
        .catch((err) => {
          if (!(err instanceof AnalystAborted)) {
            console.warn("[analyst]", err);
            send({ type: "error", message: err instanceof Error ? err.message.slice(0, 300) : "The analyst failed." });
          }
        })
        .finally(() => {
          clearInterval(heartbeat);
          closed = true;
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        });
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
}

export const analystEnabledReason = () => (env().AI_PROVIDER === "none" ? "AI is turned off (AI_PROVIDER=none)." : "AI is not configured on this server.");
