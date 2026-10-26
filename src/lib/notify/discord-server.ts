/**
 * Server-side Discord jobs (run inside the WorldView server when DISCORD_WEBHOOK_URL is set):
 *   - major-event alerts: new events at or above DISCORD_ALERT_MIN_IMPORTANCE
 *   - US market wrap once each weekday after 16:20 New York time
 * Sent ids / last wrap date persist in DATA_DIR/discord-state.json so restarts never repeat.
 */
import "server-only";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { env } from "@/lib/env";
import type { EventRepository } from "@/lib/db/types";
import { alertEmbed, discordWebhook, marketWrapEmbeds, sendDiscord, type MarketLine } from "./discord";

interface State {
  alerted: string[];
  lastWrap: string | null;
}

const file = () => path.join(env().DATA_DIR, "discord-state.json");
async function load(): Promise<State | null> {
  try {
    return JSON.parse(await readFile(file(), "utf8")) as State;
  } catch {
    return null;
  }
}
async function save(s: State) {
  await mkdir(env().DATA_DIR, { recursive: true });
  await writeFile(file(), JSON.stringify({ alerted: s.alerted.slice(-3000), lastWrap: s.lastWrap }));
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
  if (!prev) return save({ alerted: events.map((x) => x.id), lastWrap: null });
  const seen = new Set(prev.alerted);
  const fresh = events.filter((x) => !seen.has(x.id)).slice(0, MAX_PER_TICK);
  if (!fresh.length) return;
  const n = fresh.length;
  await sendDiscord(`**[WorldView]** 🚨 ${n === 1 ? "Major event" : `${n} major events`}`, fresh.map(alertEmbed));
  await save({ ...prev, alerted: [...prev.alerted, ...fresh.map((x) => x.id)] });
}

const LEVELS: Record<string, string> = { "^GSPC": "S&P 500", "^IXIC": "Nasdaq", "^DJI": "Dow", "^RUT": "Russell 2000", "^VIX": "VIX", DGS10: "US 10-yr %", "DX-Y.NYB": "Dollar index", "CL=F": "WTI crude", "GC=F": "Gold", "BTC-USD": "Bitcoin" };

function nyClock(now: number) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short", hour12: false }).formatToParts(now).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: (Number(p.hour) % 24) * 60 + Number(p.minute), weekday: p.weekday as string };
}

export async function discordMarketWrap(now = Date.now()) {
  if (!env().DISCORD_MARKET_WRAP) return;
  const ny = nyClock(now);
  if (ny.weekday === "Sat" || ny.weekday === "Sun" || ny.minutes < 16 * 60 + 20 || ny.minutes > 20 * 60) return;
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

let running = false;
/** Called periodically by the server; never throws. */
export async function discordTick(repo: EventRepository) {
  if (running || !discordWebhook()) return;
  running = true;
  try {
    await discordAlerts(repo).catch((e) => console.warn("[discord] alerts:", e instanceof Error ? e.message : e));
    await discordMarketWrap().catch((e) => console.warn("[discord] market wrap:", e instanceof Error ? e.message : e));
  } finally {
    running = false;
  }
}
