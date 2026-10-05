import { getAIProvider } from "@/lib/ai";
import { buildDailyBriefing } from "@/lib/briefing";
import { storeNarrative } from "@/lib/briefing/narrative-cache";
import { getRepository } from "@/lib/server/context";
import { handler, json } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/**
 * POST /api/briefing/narrative — AI-written summary of the current briefing.
 * Written only from the briefing structure; stored separately and labelled as interpretation.
 */
export const POST = handler(async () => {
  const ai = getAIProvider();
  if (!ai) return json({ error: "AI is not configured on this server." }, { status: 503 });
  const repo = await getRepository();
  const events = await repo.scan({ from: new Date(Date.now() - 2 * 86_400_000).toISOString() });
  const briefing = buildDailyBriefing(events);
  if (!briefing.topDevelopments.length) return json({ error: "Not enough events to summarise yet." }, { status: 409 });
  try {
    const text = await ai.writeBriefing(briefing);
    const aiNarrative = { text, provider: ai.name, model: ai.model, generatedAt: new Date().toISOString() };
    storeNarrative(aiNarrative);
    return json({ aiNarrative });
  } catch (err) {
    console.warn("[ai] briefing narrative failed:", err);
    return json({ error: err instanceof Error ? err.message : "AI request failed" }, { status: 502 });
  }
});
