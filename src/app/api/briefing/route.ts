import { buildDailyBriefing } from "@/lib/briefing";
import { cachedNarrative } from "@/lib/briefing/narrative-cache";
import { loadBriefing } from "@/lib/briefing/store";
import { env } from "@/lib/env";
import { getRepository } from "@/lib/server/context";
import { handler, json } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/**
 * GET /api/briefing — daily briefing structure, plus the AI narrative if one was
 * generated recently in this process or by today's scheduled morning job.
 */
export const GET = handler(async () => {
  const repo = await getRepository();
  const events = await repo.scan({ from: new Date(Date.now() - 2 * 86_400_000).toISOString() });
  const morning = await loadBriefing(env().DATA_DIR);
  const aiNarrative = cachedNarrative() ?? morning?.briefing.aiNarrative ?? null;
  return json({
    ...buildDailyBriefing(events),
    aiNarrative,
    morning: morning ? { date: morning.date, generatedAt: morning.generatedAt, trigger: morning.trigger } : null,
  });
});
