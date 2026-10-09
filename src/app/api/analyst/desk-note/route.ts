import { z } from "zod";
import { SYMBOL_PATTERN } from "@/lib/finance/instruments";
import { DESK_NOTE_QUESTION } from "@/lib/analyst/prompts";
import { deskNotePlan } from "@/lib/analyst/router";
import { analystEnabledReason, clientKey, getAnalystLLM, queueFull, rateLimit, streamAnalyst } from "@/lib/analyst/server";
import { badRequest, handler, json } from "@/lib/server/http";

export const dynamic = "force-dynamic";
export const maxDuration = 600;

const Body = z.object({ watchlist: z.array(z.string().regex(SYMBOL_PATTERN)).max(25).default([]) });

/**
 * POST /api/analyst/desk-note {watchlist} → NDJSON stream (same events as
 * /api/analyst/chat). The watchlist lives in client settings, so it's passed in.
 * Tools are fixed (quotes, snapshot, event exposure, news, earnings, calendar);
 * the model writes the note.
 */
export const POST = handler(async (req: Request) => {
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return badRequest(parsed.error);
  if (!getAnalystLLM()) return json({ error: analystEnabledReason() }, { status: 503 });
  const wait = rateLimit(clientKey(req));
  if (wait !== null) return json({ error: `Too many analyst requests — try again in ${wait} s.` }, { status: 429, headers: { "Retry-After": String(wait) } });
  if (queueFull()) return json({ error: "The analyst is busy with other requests — try again in a minute." }, { status: 429, headers: { "Retry-After": "60" } });
  const watchlist = [...new Set(parsed.data.watchlist.map((s) => s.toUpperCase()))];
  return streamAnalyst({ messages: [{ role: "user", content: DESK_NOTE_QUESTION(watchlist) }], watchlist, plan: deskNotePlan(watchlist) }, req.signal);
});
