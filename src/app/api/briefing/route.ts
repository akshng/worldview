import { buildDailyBriefing } from "@/lib/briefing";
import { cachedNarrative } from "@/lib/briefing/narrative-cache";
import { getRepository } from "@/lib/server/context";
import { handler, json } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** GET /api/briefing — daily briefing structure (+ cached AI narrative, if generated recently). */
export const GET = handler(async () => {
  const repo = await getRepository();
  const events = await repo.scan({ from: new Date(Date.now() - 2 * 86_400_000).toISOString() });
  return json({ ...buildDailyBriefing(events), aiNarrative: cachedNarrative() });
});
