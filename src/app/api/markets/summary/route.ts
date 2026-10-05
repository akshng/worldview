import { getAIProvider } from "@/lib/ai";
import { getMarketSnapshot, DISCLAIMER } from "@/lib/finance/service";
import { marketMovers } from "@/lib/finance/exposure";
import { getRepository } from "@/lib/server/context";
import { handler, json } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** POST /api/markets/summary — AI-written descriptive market wrap (labelled; never advice). */
export const POST = handler(async () => {
  const ai = getAIProvider();
  if (!ai) return json({ error: "AI is turned off." }, { status: 503 });
  const repo = await getRepository();
  const [snapshot, events] = await Promise.all([getMarketSnapshot(), repo.scan({ from: new Date(Date.now() - 86_400_000).toISOString(), synthetic: "exclude" })]);
  const movers = marketMovers(events, 12).map((m) => ({
    title: m.event.title,
    status: m.event.status,
    importance: m.event.importanceScore,
    where: events.find((e) => e.id === m.event.id)?.countryName ?? null,
    exposure: m.exposure,
  }));
  try {
    const text = await ai.writeMarketBrief({ snapshot, movers });
    return json({ summary: { text, provider: ai.name, model: ai.model, generatedAt: new Date().toISOString() }, disclaimer: DISCLAIMER });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "AI request failed" }, { status: 502 });
  }
});
