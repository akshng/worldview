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

describe("discord alerts and market wrap", () => {
  it("links an alert to its source and skips a location already in the title", async () => {
    const { alertEmbed } = await import("@/lib/notify/discord");
    const e = alertEmbed({ id: "a", type: "EARTHQUAKE", title: "M 7.2 earthquake — Vanuatu", summary: "s", timestamp: new Date().toISOString(), importanceScore: 81.4, status: "PARTIALLY_CONFIRMED", sourceCount: 2, countryName: "Vanuatu", locationName: null, sources: [{ sourceName: "USGS", sourceUrl: null }, { sourceName: "EMSC", sourceUrl: "https://www.emsc-csem.org/x" }] });
    expect(e.url).toBe("https://www.emsc-csem.org/x");
    expect(e.fields!.map((f) => f.name)).toEqual(["Importance", "Status", "Sources"]);
    expect(e.fields![0].value).toBe("81/100");
  });
  it("lists gainers and losers", async () => {
    const { marketWrapEmbeds } = await import("@/lib/notify/discord");
    const w = marketWrapEmbeds([{ name: "S&P 500", price: 7600, changePct: -0.5 }], [{ symbol: "ABC", name: "Abc Inc", price: 10, changePct: 12.3 }], []);
    expect(w[0].description).toContain("▼ -0.50%");
    expect(w[1].fields![0].value).toContain("▲ +12.30%");
    expect(w[1].fields![1].value).toBe("—");
  });
});
