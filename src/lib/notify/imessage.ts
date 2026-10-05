/**
 * Optional text via the macOS Messages app (iMessage) — no accounts or keys
 * beyond the Apple ID already signed in to Messages. Off unless IMESSAGE_TO is
 * set (a phone number or Apple ID email, usually your own).
 *
 * The first send asks macOS for permission to control Messages; run
 * `npm run briefing:morning` once in a terminal to approve it.
 */
import { execFile } from "node:child_process";
import type { DailyBriefing } from "@/lib/briefing";

// Recipient and text are passed as arguments, never spliced into the script.
const SCRIPT = `on run argv
  tell application "Messages"
    set svc to 1st account whose service type = iMessage
    send (item 2 of argv) to participant (item 1 of argv) of svc
  end tell
end run`;

export function imessageRecipient(e: Record<string, string | undefined> = process.env): string | null {
  return e.IMESSAGE_TO?.trim() || null;
}

/** Text body: top headlines plus the AI summary (labelled as interpretation). */
export function briefingText(b: DailyBriefing, maxChars = 1800): string {
  const parts = ["🌍 WorldView morning briefing"];
  const top = b.topDevelopments.slice(0, 5).map((d) => `• ${d.event.title}`);
  parts.push(top.length ? top.join("\n") : "No major developments in the last 24 hours.");
  if (b.aiNarrative) parts.push(`AI summary (interpretation, not verified fact):\n${b.aiNarrative.text}`);
  const text = parts.join("\n\n");
  return text.length > maxChars ? `${text.slice(0, maxChars - 1).trimEnd()}…` : text;
}

export function sendIMessage(to: string, text: string): Promise<void> {
  if (process.platform !== "darwin") return Promise.reject(new Error("iMessage needs macOS"));
  return new Promise((resolve, reject) => {
    execFile("osascript", ["-e", SCRIPT, to, text], { timeout: 30_000 }, (err, _out, stderr) =>
      err ? reject(new Error(stderr.trim() || err.message)) : resolve(),
    );
  });
}

export async function sendBriefingText(b: DailyBriefing, e: Record<string, string | undefined> = process.env): Promise<boolean> {
  const to = imessageRecipient(e);
  if (!to) return false;
  await sendIMessage(to, briefingText(b));
  return true;
}
