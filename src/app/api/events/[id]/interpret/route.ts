import { getAIProvider } from "@/lib/ai";
import { getRepository } from "@/lib/server/context";
import { handler, json, notFound } from "@/lib/server/http";
import { publish } from "@/lib/realtime/bus";

export const dynamic = "force-dynamic";

/**
 * POST /api/events/:id/interpret — generate (or regenerate) the AI interpretation.
 * Stored in `aiInterpretation`, separate from the verified summary.
 */
export const POST = handler(async (_req: Request, ctx: RouteContext<"/api/events/[id]/interpret">) => {
  const { id } = await ctx.params;
  const ai = getAIProvider();
  if (!ai) return json({ error: "AI is not configured on this server." }, { status: 503 });
  const repo = await getRepository();
  const event = await repo.get(id);
  if (!event) return notFound("Event not found");
  if (event.isSynthetic) return json({ error: "AI interpretation is disabled for simulated events." }, { status: 400 });
  const t = Date.parse(event.timestamp);
  const nearby = (await repo.findNear({ lat: event.latitude, lon: event.longitude, radiusKm: 300, fromMs: t - 48 * 3_600_000, toMs: t + 48 * 3_600_000 }))
    .filter((e) => e.id !== event.id && !e.isSynthetic)
    .sort((a, b) => b.importanceScore - a.importanceScore);
  try {
    const text = await ai.interpretEvent(event, nearby);
    const aiInterpretation = { text, provider: ai.name, model: ai.model, generatedAt: new Date().toISOString() };
    const latest = (await repo.get(id)) ?? event;
    await repo.save({ ...latest, aiInterpretation });
    publish({ type: "event.updated", eventId: id });
    return json({ aiInterpretation });
  } catch (err) {
    console.warn("[ai] interpretation failed:", err);
    return json({ error: err instanceof Error ? err.message : "AI request failed" }, { status: 502 });
  }
});
