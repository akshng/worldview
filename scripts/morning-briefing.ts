/**
 * Morning briefing job — run once, then exit (npm run briefing:morning).
 *
 *   1. Refresh every active data source
 *   2. Build the daily briefing and have the AI write its summary
 *   3. Save it to DATA_DIR/briefings/YYYY-MM-DD.json (the app shows it)
 *   4. Show a macOS notification with the top headlines (MAC_NOTIFY=false to disable)
 *   5. Unload the AI model and exit, so nothing keeps running
 *
 * If the WorldView server is already running (WORLDVIEW_URL, default
 * http://localhost:3000) the job asks it to do the work instead, so the two
 * processes never write the same data store, then tells it to unload the model.
 *
 * Scheduled daily by `npm run briefing:schedule` (macOS LaunchAgent).
 */
import { existsSync } from "node:fs";
import path from "node:path";

for (const f of [".env.local", ".env"]) {
  if (existsSync(f)) process.loadEnvFile(f);
}

const log = (msg: string) => console.log(`[${new Date().toISOString()}] ${msg}`);
const MARKET_SYMBOLS: Record<string, string> = { "^GSPC": "S&P 500", "^IXIC": "Nasdaq", "^VIX": "VIX", "DGS10": "US 10-yr %", "CL=F": "WTI crude", "GC=F": "Gold", "BTC-USD": "Bitcoin" };

/** Key market levels from the running server's snapshot (empty if unavailable). */
async function marketLines(): Promise<import("@/lib/notify/discord").MarketLine[]> {
  try {
    const res = await fetch(`${serverUrl}/api/markets`, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) return [];
    const snap = (await res.json()) as { groups: Record<string, Array<{ symbol: string; price: number | null; changePct: number | null }>> };
    const all = Object.values(snap.groups).flat();
    return Object.entries(MARKET_SYMBOLS).flatMap(([sym, name]) => {
      const q = all.find((x) => x.symbol === sym);
      return q ? [{ name, price: q.price, changePct: q.changePct }] : [];
    });
  } catch {
    return [];
  }
}

async function notify(briefing: import("@/lib/briefing").DailyBriefing) {
  const { notifyBriefingOnMac } = await import("@/lib/notify/mac");
  try {
    if (await notifyBriefingOnMac(briefing)) log("Mac notification shown");
  } catch (err) {
    log(`Mac notification failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  const { sendDiscord, briefingEmbeds, discordWebhook } = await import("@/lib/notify/discord");
  if (!discordWebhook()) return;
  try {
    if (await sendDiscord("**[WorldView]** ☀️ Daily update", briefingEmbeds(briefing, await marketLines()))) log("Discord update sent");
  } catch (err) {
    log(`Discord update failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

const serverUrl = (process.env.WORLDVIEW_URL || "http://localhost:3000").replace(/\/$/, "");

async function serverIsRunning(): Promise<boolean> {
  try {
    const res = await fetch(`${serverUrl}/api/meta`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function viaServer() {
  const { saveBriefing, localDate } = await import("@/lib/briefing/store");
  const dataDir = path.resolve(process.env.DATA_DIR || ".data");
  const auth: Record<string, string> = process.env.ADMIN_TOKEN ? { Authorization: `Bearer ${process.env.ADMIN_TOKEN}` } : {};
  log(`server is running at ${serverUrl} — using it`);
  try {
    const gen = await fetch(`${serverUrl}/api/briefing/narrative`, { method: "POST", signal: AbortSignal.timeout(15 * 60_000) });
    if (!gen.ok) log(`AI summary not written: ${(await gen.json().catch(() => ({}))).error ?? gen.status}`);
    const res = await fetch(`${serverUrl}/api/briefing`);
    if (!res.ok) throw new Error(`GET /api/briefing failed: HTTP ${res.status}`);
    const briefing = await res.json();
    delete briefing.morning;
    const file = await saveBriefing(dataDir, { date: localDate(), generatedAt: new Date().toISOString(), trigger: "scheduled", briefing });
    log(`saved ${file} (${briefing.topDevelopments?.length ?? 0} top developments, AI summary: ${briefing.aiNarrative ? "yes" : "no"})`);
    await notify(briefing);
  } finally {
    const un = await fetch(`${serverUrl}/api/ai/unload`, { method: "POST", headers: auth }).catch(() => null);
    log(un?.ok ? "asked server to unload the AI model" : "could not ask server to unload the AI model");
  }
}

async function standalone() {
  const { env } = await import("@/lib/env");
  const { openRepo, activeConnectors, runConnector } = await import("@/lib/server/context");
  const { buildDailyBriefing } = await import("@/lib/briefing");
  const { saveBriefing, localDate } = await import("@/lib/briefing/store");
  const { getAIProvider, getLocalProvider } = await import("@/lib/ai");

  const e = env();
  const repo = await openRepo();
  try {
    const connectors = activeConnectors();
    log(`refreshing ${connectors.length} sources…`);
    const runs = await Promise.all(connectors.map((c) => runConnector(c.id)));
    for (const r of runs) {
      log(`  ${r.dataSourceId.padEnd(11)} ${r.success ? "ok" : "FAILED"}  +${r.recordsCreated} new, ${r.recordsUpdated} updated${r.errors.length ? ` — ${r.errors[0]}` : ""}`);
    }
    await repo.flush?.();

    const events = await repo.scan({ from: new Date(Date.now() - 2 * 86_400_000).toISOString() });
    const briefing = buildDailyBriefing(events);
    log(`briefing: ${briefing.topDevelopments.length} top developments from ${events.length} events`);

    const ai = getAIProvider();
    if (!ai) log("AI is off (AI_PROVIDER=none) — saving without a summary");
    else if (!briefing.topDevelopments.length) log("nothing to summarise — saving without a summary");
    else {
      try {
        log(`writing AI summary with ${ai.name} (${ai.model})…`);
        const text = await ai.writeBriefing(briefing);
        briefing.aiNarrative = { text, provider: ai.name, model: ai.model, generatedAt: new Date().toISOString() };
      } catch (err) {
        log(`AI summary failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    const file = await saveBriefing(e.DATA_DIR, { date: localDate(), generatedAt: new Date().toISOString(), trigger: "scheduled", briefing });
    log(`saved ${file}`);
    await notify(briefing);
  } finally {
    if (await getLocalProvider()?.unload()) log("AI model unloaded");
    await repo.flush?.();
    await repo.close?.();
  }
}

const started = Date.now();
(async () => {
  if (await serverIsRunning()) await viaServer();
  else await standalone();
})()
  .then(() => {
    log(`done in ${Math.round((Date.now() - started) / 1000)}s — exiting`);
    process.exit(0);
  })
  .catch((err) => {
    log(`FAILED: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
    process.exit(1);
  });
