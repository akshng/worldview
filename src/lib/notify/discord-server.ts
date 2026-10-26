/**
 * Server-side Discord jobs (run inside the WorldView server when DISCORD_WEBHOOK_URL is set):
 *   - major-event alerts: new events at or above DISCORD_ALERT_MIN_IMPORTANCE
 *   - US market wrap and the stock setups scan, once each weekday after the close —
 *     run by the market-close LaunchAgent via runCloseJobs(), not by the server loop
 * Sent ids / last wrap date persist in DATA_DIR/discord-state.json so restarts never repeat.
 */
import "server-only";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { env } from "@/lib/env";
import type { EventRepository } from "@/lib/db/types";
import { alertEmbed, discordWebhook, marketWrapEmbeds, scorecardEmbeds, sendDiscord, setupEmbeds, type MarketLine } from "./discord";

export interface State {
  /** event ids and source-record ids (`dataSourceId:externalId`) already alerted */
  alerted: string[];
  /** kind → NY date of the last market-shock alert */
  shocks?: Record<string, string>;
  lastWrap: string | null;
  lastSetups?: string | null;
  lastScorecard?: string | null;
  lastEarnings?: string | null;
  /** symbol → today's highest move level alerted */
  watchMoves?: Record<string, { date: string; level: number }>;
  /** symbol → NY date it was last reported (no repeats within a week) */
  setupSeen?: Record<string, string>;
}

const file = () => path.join(env().DATA_DIR, "discord-state.json");
export async function load(): Promise<State | null> {
  try {
    return JSON.parse(await readFile(file(), "utf8")) as State;
  } catch {
    return null;
  }
}
export async function save(s: State) {
  await mkdir(env().DATA_DIR, { recursive: true });
  await writeFile(file(), JSON.stringify({ ...s, alerted: s.alerted.slice(-3000) }));
}

const WINDOW_MS = 6 * 3_600_000;
const MAX_PER_TICK = 4;

export async function discordAlerts(repo: EventRepository, now = Date.now()) {
  const e = env();
  const prev = await load();
  const events = (await repo.scan({ from: new Date(now - WINDOW_MS).toISOString() }))
    .filter((x) => !x.isSynthetic && x.status !== "RESOLVED" && x.importanceScore >= e.DISCORD_ALERT_MIN_IMPORTANCE)
    .sort((a, b) => b.importanceScore - a.importanceScore);
  // First run: remember what's already there instead of flooding the channel.
  const keys = (x: (typeof events)[number]) => [x.id, ...x.sources.map((s) => s.id)];
  if (!prev) return save({ alerted: events.flatMap(keys), lastWrap: null });
  // Also skips events the battery sentinel already alerted (matched by source record).
  const seen = new Set(prev.alerted);
  const fresh = events.filter((x) => !keys(x).some((k) => seen.has(k))).slice(0, MAX_PER_TICK);
  if (!fresh.length) return;
  const n = fresh.length;
  await sendDiscord(`**[WorldView]** 🚨 ${n === 1 ? "Major event" : `${n} major events`}`, fresh.map((e) => alertEmbed(e)));
  await save({ ...prev, alerted: [...prev.alerted, ...fresh.flatMap(keys)] });
}

const LEVELS: Record<string, string> = { "^GSPC": "S&P 500", "^IXIC": "Nasdaq", "^DJI": "Dow", "^RUT": "Russell 2000", "^VIX": "VIX", DGS10: "US 10-yr %", "DX-Y.NYB": "Dollar index", "CL=F": "WTI crude", "GC=F": "Gold", "BTC-USD": "Bitcoin" };

export function nyClock(now: number) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short", hour12: false }).formatToParts(now).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: (Number(p.hour) % 24) * 60 + Number(p.minute), weekday: p.weekday as string };
}

/** Weekday after `after` (NY minutes) on the same New York date; `late` jobs (run on wake) may run until midnight. */
function inWindow(now: number, after: number) {
  const ny = nyClock(now);
  return { ny, ok: ny.weekday !== "Sat" && ny.weekday !== "Sun" && ny.minutes >= after };
}

export async function discordMarketWrap(now = Date.now()) {
  if (!env().DISCORD_MARKET_WRAP) return;
  const { ny, ok } = inWindow(now, 16 * 60 + 20);
  if (!ok) return;
  const prev = (await load()) ?? { alerted: [], lastWrap: null };
  if (prev.lastWrap === ny.date) return;
  const { getMarketSnapshot } = await import("@/lib/finance/service");
  const { getScreener } = await import("@/lib/finance/screeners");
  const [snap, up, down] = await Promise.all([getMarketSnapshot(), getScreener("gainers").catch(() => null), getScreener("losers").catch(() => null)]);
  const all = Object.values(snap.groups).flat();
  const spx = all.find((q) => q.symbol === "^GSPC");
  // Market holiday: the index didn't print today.
  if (!spx?.asOf || nyClock(Date.parse(spx.asOf)).date !== ny.date) return save({ ...prev, lastWrap: ny.date });
  const levels: MarketLine[] = Object.entries(LEVELS).flatMap(([s, name]) => {
    const q = all.find((x) => x.symbol === s);
    return q ? [{ name, price: q.price, changePct: q.changePct }] : [];
  });
  await sendDiscord("**[WorldView]** 🔔 Market close", marketWrapEmbeds(levels, up?.rows ?? [], down?.rows ?? [], new Date(now)));
  await save({ ...prev, lastWrap: ny.date });
}

const daysBetween = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 86_400_000;

export async function discordSetups(now = Date.now()) {
  if (!env().DISCORD_SETUPS) return;
  const { ny, ok } = inWindow(now, 16 * 60 + 20);
  if (!ok) return;
  const prev = (await load()) ?? { alerted: [], lastWrap: null };
  if (prev.lastSetups === ny.date) return;
  // Mark first so a slow AI run can't trigger a second scan.
  const seen = Object.fromEntries(Object.entries(prev.setupSeen ?? {}).filter(([, d]) => daysBetween(d, ny.date) < 30));
  await save({ ...prev, lastSetups: ny.date, setupSeen: seen });
  const { scanSetups, annotateSetups } = await import("@/lib/finance/setups-service");
  const scan = await scanSetups({ max: 6 });
  const fresh = scan.setups.filter((s) => !seen[s.symbol] || daysBetween(seen[s.symbol], ny.date) >= 7).slice(0, 3);
  console.info(`[discord] setups: scanned ${scan.scanned} (${scan.failed} failed), ${scan.setups.length} hits, ${fresh.length} new`);
  if (!fresh.length) return;
  const model = await annotateSetups(fresh);
  await sendDiscord(`**[WorldView]** 🔎 ${fresh.length === 1 ? "A stock setup" : `${fresh.length} stock setups`} worth a look — rule-based screen, not advice`, setupEmbeds(fresh, model));
  const { recordPicks } = await import("@/lib/finance/setups-score-service");
  await recordPicks(fresh, ny.date).catch((e) => console.warn("[setups] could not log picks:", e));
  const after = (await load()) ?? prev;
  await save({ ...after, setupSeen: { ...seen, ...Object.fromEntries(fresh.map((s) => [s.symbol, ny.date])) } });
}

/** Fridays after the close: the scan's live track record plus the backtest. */
export async function discordScorecard(now = Date.now()) {
  const { ny, ok } = inWindow(now, 16 * 60 + 20);
  if (!ok || ny.weekday !== "Fri") return;
  const prev = (await load()) ?? { alerted: [], lastWrap: null };
  if (prev.lastScorecard === ny.date) return;
  const { liveScorecard, backtestSetups } = await import("@/lib/finance/setups-score-service");
  const [live, bt] = await Promise.all([liveScorecard(), backtestSetups()]);
  await sendDiscord("**[WorldView]** 📊 Weekly scorecard: did the stock scan work?", scorecardEmbeds(live, bt));
  await save({ ...((await load()) ?? prev), lastScorecard: ny.date });
}

let running = false;
/** Called every 2 minutes by the server: major-event alerts only. Never throws. */
export async function discordTick(repo: EventRepository) {
  if (running || !discordWebhook()) return;
  running = true;
  try {
    await discordAlerts(repo).catch((e) => console.warn("[discord] alerts:", e instanceof Error ? e.message : e));
    const { watchMoves } = await import("./watch");
    await watchMoves().catch((e) => console.warn("[discord] watchlist:", e instanceof Error ? e.message : e));
  } finally {
    running = false;
  }
}

/**
 * After-close jobs (market wrap, then setups scan). Run once a weekday by the
 * market-close LaunchAgent (scripts/market-close.ts); safe to call repeatedly.
 */
export async function runCloseJobs(): Promise<string[]> {
  const log: string[] = [];
  if (!discordWebhook()) return ["DISCORD_WEBHOOK_URL not set — nothing to do"];
  const step = async (name: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
      log.push(`${name}: ok`);
    } catch (e) {
      log.push(`${name}: failed — ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  await step("market wrap", () => discordMarketWrap());
  await step("setups", () => discordSetups());
  await step("watchlist earnings", async () => (await import("./watch")).watchEarnings());
  await step("weekly scorecard", () => discordScorecard());
  return log;
}
