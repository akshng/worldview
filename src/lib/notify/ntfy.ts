/**
 * Optional phone push via ntfy (https://ntfy.sh) — keyless, no account.
 * Off unless NTFY_TOPIC is set. Install the ntfy app and subscribe to the topic.
 *
 * Topics on the public ntfy.sh server can be read by anyone who knows the name,
 * so use a long random topic and only send a headline-level summary.
 */
import type { DailyBriefing } from "@/lib/briefing";

export function ntfyConfig(e: Record<string, string | undefined> = process.env) {
  const topic = e.NTFY_TOPIC?.trim();
  if (!topic) return null;
  return { server: (e.NTFY_SERVER?.trim() || "https://ntfy.sh").replace(/\/$/, ""), topic };
}

/** Short push text: top headlines only (never the full briefing). */
export function briefingPushText(b: DailyBriefing, max = 3): string {
  const lines = b.topDevelopments.slice(0, max).map((d) => `• ${d.event.title}`);
  if (!lines.length) lines.push("No major developments in the last 24 hours.");
  if (b.aiNarrative) lines.push("AI summary ready — open WorldView to read it.");
  return lines.join("\n").slice(0, 1000);
}

export async function sendBriefingPush(b: DailyBriefing, e: Record<string, string | undefined> = process.env): Promise<boolean> {
  const cfg = ntfyConfig(e);
  if (!cfg) return false;
  const res = await fetch(`${cfg.server}/${encodeURIComponent(cfg.topic)}`, {
    method: "POST",
    body: briefingPushText(b),
    headers: { Title: "WorldView morning briefing", Tags: "globe_with_meridians", Priority: "default" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`ntfy HTTP ${res.status}`);
  return true;
}
