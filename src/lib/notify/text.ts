import type { DailyBriefing } from "@/lib/briefing";

/** Text body: top headlines plus the AI summary (labelled as interpretation). */
export function briefingText(b: DailyBriefing, maxChars = 1800): string {
  const parts = ["🌍 WorldView morning briefing"];
  const top = b.topDevelopments.slice(0, 5).map((d) => `• ${d.event.title}`);
  parts.push(top.length ? top.join("\n") : "No major developments in the last 24 hours.");
  if (b.aiNarrative) parts.push(`AI summary (interpretation, not verified fact):\n${b.aiNarrative.text}`);
  const text = parts.join("\n\n");
  return text.length > maxChars ? `${text.slice(0, maxChars - 1).trimEnd()}…` : text;
}
