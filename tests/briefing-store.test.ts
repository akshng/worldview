import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildDailyBriefing } from "@/lib/briefing";
import { loadBriefing, localDate, saveBriefing } from "@/lib/briefing/store";

describe("saved briefings", () => {
  it("uses the local calendar date", () => {
    expect(localDate(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
  });

  it("round-trips a briefing by date", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "wv-briefing-"));
    const briefing = buildDailyBriefing([], Date.parse("2026-10-04T07:30:00Z"));
    briefing.aiNarrative = { text: "Quiet day.", provider: "local", model: "test", generatedAt: "2026-10-04T07:31:00Z" };
    await saveBriefing(dir, { date: "2026-10-04", generatedAt: "2026-10-04T07:31:00Z", trigger: "scheduled", briefing });
    const loaded = await loadBriefing(dir, "2026-10-04");
    expect(loaded?.trigger).toBe("scheduled");
    expect(loaded?.briefing.aiNarrative?.text).toBe("Quiet day.");
    expect(await loadBriefing(dir, "2026-10-03")).toBeNull();
    expect(await loadBriefing(dir, "../../etc/passwd")).toBeNull();
  });
});

describe("ntfy push", () => {
  it("is off without a topic and sends headline-level text only", async () => {
    const { ntfyConfig, briefingPushText } = await import("@/lib/notify/ntfy");
    expect(ntfyConfig({})).toBeNull();
    expect(ntfyConfig({ NTFY_TOPIC: "abc", NTFY_SERVER: "https://n.example/" })).toEqual({ server: "https://n.example", topic: "abc" });
    const b = buildDailyBriefing([], Date.now());
    expect(briefingPushText(b)).toContain("No major developments");
  });
});
