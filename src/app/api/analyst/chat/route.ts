import { z } from "zod";
import { SYMBOL_PATTERN } from "@/lib/finance/instruments";
import { analystEnabledReason, clientKey, getAnalystLLM, queueFull, rateLimit, streamAnalyst } from "@/lib/analyst/server";
import { badRequest, handler, json } from "@/lib/server/http";

export const dynamic = "force-dynamic";
export const maxDuration = 600;

const Body = z.object({
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(8000) }))
    .min(1)
    .max(20)
    .refine((m) => m.at(-1)!.role === "user" && m.at(-1)!.content.trim().length > 0, "The last message must be a non-empty user question"),
  watchlist: z.array(z.string().regex(SYMBOL_PATTERN)).max(25).default([]),
  mode: z.enum(["auto", "agent", "routed"]).default("auto"),
});

/**
 * POST /api/analyst/chat {messages, watchlist?, mode?} → NDJSON stream of
 * AnalystStreamEvent lines: start, step ("calling get_quote(NVDA)"), tool_result,
 * answer_delta (local model), answer (with citations), or error.
 */
export const POST = handler(async (req: Request) => {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest(parsed.error);
  if (!getAnalystLLM()) return json({ error: analystEnabledReason() }, { status: 503 });
  const wait = rateLimit(clientKey(req));
  if (wait !== null) return json({ error: `Too many analyst requests — try again in ${wait} s.` }, { status: 429, headers: { "Retry-After": String(wait) } });
  if (queueFull()) return json({ error: "The analyst is busy with other requests — try again in a minute." }, { status: 429, headers: { "Retry-After": "60" } });
  return streamAnalyst({ messages: parsed.data.messages, watchlist: parsed.data.watchlist.map((s) => s.toUpperCase()), mode: parsed.data.mode }, req.signal);
});
