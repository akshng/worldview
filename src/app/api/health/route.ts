import { readdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { aiStatus } from "@/lib/ai";
import { briefingsDir, loadBriefing } from "@/lib/briefing/store";
import { env } from "@/lib/env";
import { getRepository, getSourceHealth, serverInfo } from "@/lib/server/context";
import { briefingLateMinutes, healthOk, scheduledTime, summarizeSources } from "@/lib/server/health-summary";
import { handler, json } from "@/lib/server/http";

export const dynamic = "force-dynamic";

async function lastBriefing() {
  const dataDir = env().DATA_DIR;
  const dates = (await readdir(briefingsDir(dataDir)).catch(() => [] as string[]))
    .map((f) => f.match(/^(\d{4}-\d{2}-\d{2})\.json$/)?.[1])
    .filter((d): d is string => !!d)
    .sort();
  const latest = dates.length ? await loadBriefing(dataDir, dates[dates.length - 1]) : null;
  if (!latest) return { lastBriefingAt: null, lastBriefingLateMinutes: null };
  const plist = await readFile(path.join(os.homedir(), "Library", "LaunchAgents", "com.worldview.morning-briefing.plist"), "utf8").catch(() => null);
  return {
    lastBriefingAt: latest.generatedAt,
    lastBriefingLateMinutes: latest.trigger === "scheduled" ? briefingLateMinutes(latest.date, latest.generatedAt, scheduledTime(plist)) : null,
  };
}

/**
 * GET /api/health — small, cheap health summary: server uptime, source status counts and
 * anomalies, last morning briefing (and how late it ran vs its schedule), AI status.
 */
export const GET = handler(async () => {
  await getRepository();
  const [sources, briefing] = await Promise.all([getSourceHealth(), lastBriefing()]);
  const summary = summarizeSources(sources);
  const { startedAt } = serverInfo();
  return json({
    ok: healthOk(sources),
    server: { startedAt: new Date(startedAt).toISOString(), uptimeS: Math.round((Date.now() - startedAt) / 1000) },
    sources: summary,
    ...briefing,
    ai: aiStatus(),
  });
});
