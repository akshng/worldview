import { z } from "zod";
import { getRepository } from "@/lib/server/context";
import { search } from "@/lib/search";
import { getAIProvider } from "@/lib/ai";
import { badRequest, handler, json } from "@/lib/server/http";

export const dynamic = "force-dynamic";

const Query = z.object({ q: z.string().trim().min(1).max(200), ai: z.enum(["1"]).optional() });

/**
 * GET /api/search?q= — locations, events and topics (+ parsed intent).
 * `&ai=1` asks the AI provider to interpret the query into filters (never facts).
 */
export const GET = handler(async (req: Request) => {
  const parsed = Query.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!parsed.success) return badRequest(parsed.error);
  const repo = await getRepository();
  if (parsed.data.ai) {
    const ai = getAIProvider();
    if (!ai) return json({ error: "AI is not configured on this server." }, { status: 503 });
    try {
      return json(await search(repo, parsed.data.q, { interpret: (q) => ai.parseCommand(q) }));
    } catch (err) {
      console.warn("[ai] command interpretation failed:", err);
      return json({ error: err instanceof Error ? err.message : "AI request failed" }, { status: 502 });
    }
  }
  return json(await search(repo, parsed.data.q));
});
