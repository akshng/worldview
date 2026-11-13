/**
 * Watchlist alerts to Discord:
 *   - big moves: a watchlist stock up/down WATCH_MOVE_PCT% on the day (again at 2× that), market hours
 *   - earnings ahead: after the close, which watchlist names report on the next trading day
 * Cheap (a handful of quotes, no AI) so it runs both in the server loop and the battery sentinel.
 */
import "server-only";
import { env } from "@/lib/env";
import { loadWatchlist } from "@/lib/server/watchlist";
import { discordWebhook, sendDiscord, type DiscordEmbed } from "./discord";
import { load, nyClock, update } from "./discord-server";

export async function watchMoves(now = Date.now()): Promise<string> {
  if (!discordWebhook()) return "watchlist: no webhook";
  const ny = nyClock(now);
  if (ny.weekday === "Sat" || ny.weekday === "Sun" || ny.minutes < 9 * 60 + 35 || ny.minutes > 16 * 60 + 5) return "watchlist: market closed";
  const symbols = await loadWatchlist();
  if (!symbols.length) return "watchlist: empty";
  const { getQuote } = await import("@/lib/finance/service");
  const step = env().WATCH_MOVE_PCT;
  const state = (await load()) ?? { alerted: [], lastWrap: null };
  const moved = state.watchMoves ?? {};
  const hits: Array<{ symbol: string; name: string; price: number; changePct: number; level: number }> = [];
  for (const sym of symbols) {
    const q = await getQuote(sym, "watchlist").catch(() => null);
    if (!q || q.price === null || q.changePct === null || (q.asOf && nyClock(Date.parse(q.asOf)).date !== ny.date)) continue;
    const level = Math.floor(Math.abs(q.changePct) / step); // 1 = ≥step, 2 = ≥2×step …
    const prev = moved[sym]?.date === ny.date ? moved[sym].level : 0;
    if (level >= 1 && level > prev) hits.push({ symbol: sym, name: q.name, price: q.price, changePct: q.changePct, level });
  }
  if (!hits.length) return `watchlist: ${symbols.length} checked, no big moves`;
  const embeds: DiscordEmbed[] = hits.map((h) => ({
    title: `${h.symbol} ${h.changePct > 0 ? "▲ +" : "▼ "}${h.changePct.toFixed(2)}% today`,
    url: `https://finance.yahoo.com/quote/${encodeURIComponent(h.symbol)}`,
    description: `${h.name} at $${h.price.toLocaleString("en-US", { maximumFractionDigits: 2 })}${h.level > 1 ? ` · past ${h.level * step}%` : ""}`,
    color: h.changePct > 0 ? 0x2e9e6b : 0xe5484d,
  }));
  await sendDiscord(`**[WorldView]** 👀 Watchlist ${hits.length === 1 ? "move" : "moves"}`, embeds);
  await update((s) => ({ ...s, watchMoves: { ...(s.watchMoves ?? {}), ...Object.fromEntries(hits.map((h) => [h.symbol, { date: ny.date, level: h.level }])) } }));
  return `watchlist: alerted ${hits.map((h) => h.symbol).join(", ")}`;
}

/** Next weekday after `date` (YYYY-MM-DD); holidays are left to the calendar (no rows). */
export function nextWeekday(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  do d.setUTCDate(d.getUTCDate() + 1);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
  return d.toISOString().slice(0, 10);
}

export async function watchEarnings(now = Date.now()) {
  const ny = nyClock(now);
  if (ny.weekday === "Sat" || ny.weekday === "Sun" || ny.minutes < 16 * 60) return;
  const prev = (await load()) ?? { alerted: [], lastWrap: null };
  if (prev.lastEarnings === ny.date) return;
  const symbols = new Set(await loadWatchlist());
  const day = nextWeekday(ny.date);
  const { earningsOn } = await import("@/lib/finance/earnings-calendar");
  const rows = symbols.size ? (await earningsOn(day)).filter((r) => symbols.has(r.symbol)) : [];
  if (rows.length) {
    const label = new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" });
    await sendDiscord(`**[WorldView]** 📅 Earnings ${label} on your watchlist`, [
      {
        title: `Reporting ${label}`,
        description: rows.map((r) => `**${r.symbol}** ${r.name} · ${r.when}${r.epsForecast ? ` · EPS forecast ${r.epsForecast}` : ""}${r.lastYearEps ? ` (year ago ${r.lastYearEps})` : ""}`).join("\n"),
        footer: { text: "WorldView · dates from Nasdaq's earnings calendar; companies can change them." },
      },
    ]);
  }
  await update((s) => ({ ...s, lastEarnings: ny.date }));
}
