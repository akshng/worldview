/**
 * Discord updates via an incoming webhook (DISCORD_WEBHOOK_URL). Every message is
 * posted as "WorldView" so it's distinguishable from other apps posting to the
 * same channel. Webhooks post to a channel; they cannot DM a user.
 */
import type { DailyBriefing } from "@/lib/briefing";

export const DISCORD_NAME = "WorldView";
const COLOR = 0x2ec4b6;

export interface DiscordEmbed {
  title?: string;
  description?: string;
  url?: string;
  color?: number;
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
  footer?: { text: string };
  timestamp?: string;
}

/** Accept only official Discord webhook URLs. */
export function discordWebhook(e: Record<string, string | undefined> = process.env): string | null {
  const u = e.DISCORD_WEBHOOK_URL?.trim();
  return u && /^https:\/\/(?:ptb\.|canary\.)?(?:discord|discordapp)\.com\/api\/webhooks\/\d+\/[\w-]+$/.test(u) ? u : null;
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** Discord limits: content 2000, embed description 4096, field value 1024, 10 embeds. */
export function discordPayload(content: string, embeds: DiscordEmbed[] = []) {
  return {
    username: DISCORD_NAME,
    content: clip(content, 2000),
    allowed_mentions: { parse: [] as string[] },
    embeds: embeds.slice(0, 10).map((e) => ({
      color: COLOR,
      ...e,
      title: e.title ? clip(e.title, 256) : undefined,
      description: e.description ? clip(e.description, 4096) : undefined,
      fields: e.fields?.slice(0, 25).map((f) => ({ ...f, name: clip(f.name, 256), value: clip(f.value || "—", 1024) })),
      footer: { text: clip(e.footer?.text ?? "WorldView · information only, not investment advice", 2048) },
    })),
  };
}

export async function sendDiscord(content: string, embeds: DiscordEmbed[] = [], e: Record<string, string | undefined> = process.env): Promise<boolean> {
  const url = discordWebhook(e);
  if (!url) return false;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(discordPayload(content, embeds)),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Discord webhook HTTP ${res.status}`);
  return true;
}

export interface MarketLine {
  name: string;
  price: number | null;
  changePct: number | null;
}

/** Morning update: AI summary, top developments, and a few market levels. */
export function briefingEmbeds(b: DailyBriefing, markets: MarketLine[] = [], date = new Date()): DiscordEmbed[] {
  const day = date.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
  const top = b.topDevelopments.slice(0, 8).map((d) => {
    const where = d.event.countryName ?? d.event.locationName ?? "";
    const show = where && !d.event.title.toLowerCase().includes(where.toLowerCase());
    return `• **${d.event.title}**${show ? ` — ${where}` : ""}`;
  });
  const embeds: DiscordEmbed[] = [
    {
      title: `Morning briefing · ${day}`,
      description: b.aiNarrative ? `${b.aiNarrative.text}\n\n*AI summary (${b.aiNarrative.model}) — interpretation, not verified fact.*` : "No AI summary today.",
      timestamp: date.toISOString(),
    },
    { title: "Top developments", description: top.length ? top.join("\n") : "No major developments in the last 24 hours." },
  ];
  const lines = markets
    .filter((m) => m.price !== null)
    .map((m) => {
      const ch = m.changePct;
      const arrow = ch === null ? "" : ch > 0 ? "▲" : ch < 0 ? "▼" : "■";
      return `${m.name}: ${m.price!.toLocaleString("en-US", { maximumFractionDigits: 2 })}${ch === null ? "" : ` ${arrow} ${ch > 0 ? "+" : ""}${ch.toFixed(2)}%`}`;
    });
  if (lines.length) embeds.push({ title: "Markets (delayed)", description: lines.join("\n") });
  return embeds;
}

const pct = (v: number | null) => (v === null ? "" : `${v > 0 ? "▲ +" : v < 0 ? "▼ " : "■ "}${v.toFixed(2)}%`);
const TYPE_ICON: Record<string, string> = { EARTHQUAKE: "🌋", WEATHER: "🌀", FLOOD: "🌊", WILDFIRE: "🔥", CONFLICT: "⚔️", VOLCANO: "🌋", TSUNAMI: "🌊", HEALTH: "🦠" };

export interface AlertEvent {
  id: string;
  type: string;
  title: string;
  summary: string;
  timestamp: string;
  importanceScore: number;
  status: string;
  sourceCount: number;
  countryName: string | null;
  locationName: string | null;
  sources: Array<{ sourceName: string; sourceUrl: string | null }>;
}

/** One embed per major event; links to the first source that has a URL. */
export function alertEmbed(e: AlertEvent, aiNote?: { text: string; model: string }): DiscordEmbed {
  const link = e.sources.find((s) => s.sourceUrl);
  const where = e.countryName ?? e.locationName;
  return {
    title: `${TYPE_ICON[e.type] ?? "⚠️"} ${e.title}`,
    url: link?.sourceUrl ?? undefined,
    description: `${clip(e.summary, 500)}${aiNote ? `\n\n**Why it may matter** — ${clip(aiNote.text, 1200)}\n*AI interpretation (${aiNote.model}), not verified fact.*` : ""}`,
    color: 0xe5484d,
    fields: [
      { name: "Importance", value: `${Math.round(e.importanceScore)}/100`, inline: true },
      { name: "Status", value: e.status.replace(/_/g, " ").toLowerCase(), inline: true },
      { name: "Sources", value: `${e.sourceCount}${link ? ` · [${link.sourceName}](${link.sourceUrl})` : ""}`, inline: true },
      ...(where && !e.title.toLowerCase().includes(where.toLowerCase()) ? [{ name: "Where", value: where, inline: true }] : []),
    ],
    timestamp: e.timestamp,
  };
}

export interface Mover {
  symbol: string;
  name: string;
  price: number | null;
  changePct: number | null;
}

/** End-of-day US market wrap: levels plus top gainers / losers. */
export function marketWrapEmbeds(levels: MarketLine[], gainers: Mover[], losers: Mover[], date = new Date()): DiscordEmbed[] {
  const lv = levels.filter((m) => m.price !== null).map((m) => `${m.name}: ${m.price!.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${pct(m.changePct)}`);
  const mv = (rows: Mover[]) => rows.slice(0, 5).map((r) => `**${r.symbol}** ${clip(r.name, 28)} ${pct(r.changePct)}`).join("\n") || "—";
  return [
    { title: `Market close · ${date.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "America/New_York" })}`, description: lv.join("\n") || "Quotes unavailable.", timestamp: date.toISOString() },
    { title: "Movers (US, delayed)", fields: [{ name: "Top gainers", value: mv(gainers), inline: true }, { name: "Top losers", value: mv(losers), inline: true }] },
  ];
}

/** "Setups worth a look": one embed per rule-flagged stock, with the AI note when available. */
export function setupEmbeds(setups: import("@/lib/finance/setups").Setup[], aiModel: string | null): DiscordEmbed[] {
  return setups.map((s) => {
    const m = s.metrics;
    const body = s.note ?? [...s.signals.map((x) => `✅ ${x}`), ...s.risks.map((x) => `⚠️ ${x}`)].join("\n");
    return {
      title: `${s.symbol} · ${clip(s.name, 60)}`,
      url: `https://finance.yahoo.com/quote/${encodeURIComponent(s.symbol)}`,
      description: `${s.signals.map((x) => `✅ ${x}`).join("\n")}${s.risks.length ? `\n${s.risks.map((x) => `⚠️ ${x}`).join("\n")}` : ""}${s.note ? `\n\n${body}\n\n*AI note${aiModel ? ` (${aiModel})` : ""} — interpretation from the numbers above, not verified research.*` : ""}`,
      color: 0xf5a524,
      fields: [
        { name: "Price", value: `$${m.price.toFixed(2)} ${pct(m.change1d)}`, inline: true },
        { name: "From 52w high", value: `${m.fromHigh.toFixed(1)}%`, inline: true },
        { name: "RSI(14)", value: m.rsi14 === null ? "—" : m.rsi14.toFixed(0), inline: true },
        { name: "Trend", value: m.sma200 === null ? "—" : m.price > m.sma200 ? "Above 200-day avg" : "Below 200-day avg", inline: true },
        ...(s.funds ? [{ name: "Tracked funds holding", value: String(s.funds), inline: true }] : []),
        ...(s.insiders ? [{ name: "Insiders (90d)", value: `${s.insiders.buyers} buying · ${s.insiders.sellers} selling`, inline: true }] : []),
      ],
      footer: { text: "WorldView · rule-based screen, not a recommendation. Do your own research; you can lose money." },
    };
  });
}

type Summary = import("@/lib/finance/setups-score").ScoreSummary;
const sx = (v: number | null) => (v === null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(2)} pts`);
const rate = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);
function horizonLines(s: Summary) {
  return s.horizons.map((h) => `${h.days === 1 ? "1 day" : h.days === 5 ? "1 week" : "1 month"}: ${sx(h.avgExcess)} vs S&P · beat it ${rate(h.beatRate)} (n=${h.n})`).join("\n");
}

/** Weekly honesty check: how the scan's picks did, and how its rules did in the backtest. */
export function scorecardEmbeds(live: { summary: Summary; picks: Array<{ date: string; symbol: string; r5: number | null; x5: number | null }> }, bt: { from: string | null; to: string | null; signals: Summary; baseline: Summary; caveats: string[] }): DiscordEmbed[] {
  const recent = live.picks.slice(0, 10).map((p) => `${p.date} **${p.symbol}** · 1 week: ${p.r5 === null ? "pending" : `${p.r5 > 0 ? "+" : ""}${p.r5.toFixed(1)}% (${sx(p.x5)} vs S&P)`}`);
  return [
    {
      title: "Setups scorecard · live picks",
      description: live.summary.n ? `${live.summary.n} picks so far\n${horizonLines(live.summary)}\n\n${recent.join("\n")}` : "No picks posted yet.",
      color: 0x5b8def,
    },
    {
      title: `Backtest of the same rules · ${bt.from ?? "?"} to ${bt.to ?? "?"}`,
      description: `**Signals** (n=${bt.signals.n})\n${horizonLines(bt.signals)}\n\n**Any stock, any day** (for comparison)\n${horizonLines(bt.baseline)}\n\n*${bt.caveats[0]} ${bt.caveats[3]}*`,
      color: 0x5b8def,
      footer: { text: "WorldView · a screen's track record, not a forecast. Not investment advice." },
    },
  ];
}
