/**
 * Optional phone push via ntfy (https://ntfy.sh) — keyless, no account.
 * Off unless NTFY_TOPIC is set. Install the ntfy app and subscribe to the topic.
 *
 * Topics on the public ntfy.sh server can be read by anyone who knows the name,
 * so use a long random topic. The message is public world news only (headlines +
 * AI summary) — nothing personal is ever sent.
 */
import type { DailyBriefing } from "@/lib/briefing";
import { briefingText } from "./text";

export function ntfyConfig(e: Record<string, string | undefined> = process.env) {
  const topic = e.NTFY_TOPIC?.trim();
  if (!topic) return null;
  return { server: (e.NTFY_SERVER?.trim() || "https://ntfy.sh").replace(/\/$/, ""), topic };
}

export async function sendBriefingPush(b: DailyBriefing, e: Record<string, string | undefined> = process.env): Promise<boolean> {
  const cfg = ntfyConfig(e);
  if (!cfg) return false;
  const res = await fetch(`${cfg.server}/${encodeURIComponent(cfg.topic)}`, {
    method: "POST",
    body: briefingText(b).replace(/^.*\n\n/, ""), // title is sent as a header
    headers: { Title: "WorldView morning briefing", Tags: "globe_with_meridians", Priority: "default" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`ntfy HTTP ${res.status}`);
  return true;
}
