/**
 * Battery sentinel: a cheap check that runs every 15 minutes while the main
 * server is off (on battery). It fetches only a few authoritative feeds and two
 * quotes, applies the same importance rules as the server, and only when
 * something crosses the bar does it load the AI, write a note, post to Discord
 * and unload the AI again. Most runs end in a second or two with no AI at all.
 */
import "server-only";
import { env, userAgent } from "@/lib/env";
import { getConnector } from "@/data-sources/registry";
import { EventCandidateSchema, type WorldEvent } from "@/types/events";
import { enrichGeo, normalizeCandidate } from "@/lib/ingestion/pipeline";
import { createEvent, recompute } from "@/lib/events/build";
import { alertEmbed, discordWebhook, sendDiscord, type DiscordEmbed } from "./discord";
import { load, nyClock, save } from "./discord-server";

const FEEDS = ["usgs", "gdacs", "tsunami"];
const WINDOW_MS = 6 * 3_600_000;
/** One feed = one source, so scores run ~4–7 points below the server's corroborated ones. */
const SINGLE_SOURCE_ALLOWANCE = 5;

/** Score candidates from a few feeds exactly as the server would for a single-source event. */
async function candidateEvents(now: number): Promise<WorldEvent[]> {
  const out: WorldEvent[] = [];
  for (const id of FEEDS) {
    const conn = getConnector(id);
    if (!conn) continue;
    try {
      const raw = await conn.fetch({ signal: AbortSignal.timeout(conn.timeoutMs ?? 30_000), lastSuccessAt: null, now, userAgent: userAgent(), env: process.env as Record<string, string | undefined> });
      for (const input of conn.parse(raw, { now, retrievedAt: new Date(now).toISOString() }).candidates) {
        const p = EventCandidateSchema.safeParse(input);
        if (!p.success) continue;
        const c = normalizeCandidate(p.data);
        out.push(recompute(createEvent(c, enrichGeo(c), now), now));
      }
    } catch (e) {
      console.warn(`[sentinel] ${id}: ${e instanceof Error ? e.message : e}`);
    }
  }
  return out;
}

interface Shock {
  kind: string;
  text: string;
}

/** Big market moves during US trading hours: S&P 500 ≤ −2% or VIX up ≥ 20% (above 25). */
async function marketShocks(now: number): Promise<Shock[]> {
  const ny = nyClock(now);
  if (ny.weekday === "Sat" || ny.weekday === "Sun" || ny.minutes < 9 * 60 + 45 || ny.minutes > 16 * 60) return [];
  const { getQuote } = await import("@/lib/finance/service");
  const [spx, vix] = await Promise.all([getQuote("^GSPC").catch(() => null), getQuote("^VIX").catch(() => null)]);
  const out: Shock[] = [];
  if (spx?.changePct !== null && spx?.changePct !== undefined && spx.changePct <= -2) out.push({ kind: "spx", text: `S&P 500 ${spx.changePct.toFixed(2)}% at ${spx.price?.toLocaleString("en-US")}` });
  if (vix?.changePct != null && vix.price != null && vix.changePct >= 20 && vix.price > 25) out.push({ kind: "vix", text: `VIX +${vix.changePct.toFixed(1)}% to ${vix.price.toFixed(2)}` });
  return out;
}

export async function runSentinel(now = Date.now()): Promise<string[]> {
  const log: string[] = [];
  if (!discordWebhook()) return ["DISCORD_WEBHOOK_URL not set — nothing to do"];
  const state = (await load()) ?? { alerted: [], lastWrap: null };
  const seen = new Set(state.alerted);
  const min = env().DISCORD_ALERT_MIN_IMPORTANCE - SINGLE_SOURCE_ALLOWANCE;

  const events = (await candidateEvents(now))
    .filter((e) => e.status !== "RESOLVED" && e.importanceScore >= min && now - Date.parse(e.timestamp) < WINDOW_MS)
    .filter((e) => !e.sources.some((s) => seen.has(s.id)))
    .sort((a, b) => b.importanceScore - a.importanceScore)
    .slice(0, 3);
  const ny = nyClock(now);
  const shocks = (await marketShocks(now)).filter((s) => state.shocks?.[s.kind] !== ny.date);
  log.push(`checked ${FEEDS.join(", ")} + markets: ${events.length} event(s), ${shocks.length} market shock(s) over the bar`);
  if (!events.length && !shocks.length) return log;

  // Something tripped — only now wake the AI, then put it straight back to sleep.
  const { getAIProvider, getLocalProvider } = await import("@/lib/ai");
  const ai = getAIProvider();
  const embeds: DiscordEmbed[] = [];
  try {
    for (const e of events) {
      let note: { text: string; model: string } | undefined;
      if (ai) {
        try {
          note = { text: await ai.interpretEvent(e, []), model: ai.model };
        } catch (err) {
          log.push(`AI note failed: ${err instanceof Error ? err.message : err}`);
        }
      }
      embeds.push(alertEmbed(e, note));
    }
    if (shocks.length) {
      let text = shocks.map((s) => `• ${s.text}`).join("\n");
      if (ai) {
        try {
          const { getMarketSnapshot } = await import("@/lib/finance/service");
          text += `\n\n${await ai.writeMarketBrief({ snapshot: await getMarketSnapshot(), movers: [] })}\n*AI summary (${ai.model}) — description, not advice.*`;
        } catch (err) {
          log.push(`AI market note failed: ${err instanceof Error ? err.message : err}`);
        }
      }
      embeds.push({ title: "📉 Big market move", description: text, color: 0xe5484d, timestamp: new Date(now).toISOString() });
    }
  } finally {
    if (await getLocalProvider()?.unload().catch(() => false)) log.push("AI model unloaded");
  }
  const parts = [events.length ? `${events.length} major event${events.length > 1 ? "s" : ""}` : "", shocks.length ? "big market move" : ""].filter(Boolean).join(" + ");
  await sendDiscord(`**[WorldView]** 🚨 ${parts}`, embeds);
  const after = (await load()) ?? state;
  await save({
    ...after,
    alerted: [...after.alerted, ...events.flatMap((e) => e.sources.map((s) => s.id))],
    shocks: { ...(after.shocks ?? {}), ...Object.fromEntries(shocks.map((s) => [s.kind, ny.date])) },
  });
  log.push(`posted: ${parts}`);
  return log;
}
