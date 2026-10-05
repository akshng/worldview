/**
 * macOS notification for the morning briefing (Notification Center, via osascript).
 * On by default on macOS; set MAC_NOTIFY=false to turn it off.
 */
import { execFile } from "node:child_process";
import type { DailyBriefing } from "@/lib/briefing";

// Title and text are passed as arguments, never spliced into the script.
const SCRIPT = `on run argv
  display notification (item 2 of argv) with title (item 1 of argv) sound name "Glass"
end run`;

export function macNotifyEnabled(e: Record<string, string | undefined> = process.env, platform = process.platform): boolean {
  return platform === "darwin" && e.MAC_NOTIFY?.trim().toLowerCase() !== "false";
}

/** Notification body: the top headlines (Notification Center shows ~3 lines). */
export function briefingNotificationText(b: DailyBriefing): string {
  const top = b.topDevelopments.slice(0, 3).map((d) => `• ${d.event.title}`);
  const body = top.length ? top.join("\n") : "No major developments in the last 24 hours.";
  return b.aiNarrative ? `${body}\nAI summary ready — open the Daily briefing in WorldView.` : body;
}

export function sendMacNotification(title: string, text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile("osascript", ["-e", SCRIPT, title, text], { timeout: 15_000 }, (err, _out, stderr) =>
      err ? reject(new Error(stderr.trim() || err.message)) : resolve(),
    );
  });
}

export async function notifyBriefingOnMac(b: DailyBriefing, e: Record<string, string | undefined> = process.env): Promise<boolean> {
  if (!macNotifyEnabled(e)) return false;
  await sendMacNotification("WorldView morning briefing", briefingNotificationText(b));
  return true;
}
