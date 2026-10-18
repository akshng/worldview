import { describe, expect, it } from "vitest";
import { briefingEmbeds, discordPayload, discordWebhook } from "@/lib/notify/discord";
import { buildDailyBriefing } from "@/lib/briefing";

describe("discord updates", () => {
  it("accepts only Discord webhook URLs", () => {
    expect(discordWebhook({ DISCORD_WEBHOOK_URL: "https://discord.com/api/webhooks/123/abc-DEF_9" })).toBeTruthy();
    expect(discordWebhook({ DISCORD_WEBHOOK_URL: "https://evil.example/api/webhooks/1/x" })).toBeNull();
    expect(discordWebhook({})).toBeNull();
  });
  it("posts as WorldView, without pings, within Discord limits", () => {
    const p = discordPayload("x".repeat(3000), [{ title: "t", description: "d".repeat(5000) }]);
    expect(p.username).toBe("WorldView");
    expect(p.allowed_mentions.parse).toEqual([]);
    expect(p.content.length).toBe(2000);
    expect(p.embeds[0].description!.length).toBe(4096);
  });
  it("builds a morning briefing with markets", () => {
    const e = briefingEmbeds(buildDailyBriefing([], Date.now()), [{ name: "S&P 500", price: 7789.5, changePct: 0.86 }]);
    expect(e.map((x) => x.title?.split(" ·")[0])).toEqual(["Morning briefing", "Top developments", "Markets (delayed)"]);
    expect(e[2].description).toContain("▲ +0.86%");
  });
});
