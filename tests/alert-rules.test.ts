import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AlertRuleSchema, AlertRulesSchema, matchesRule, ruleKeys, selectRuleHits, stampRules, type AlertRule, type RuleEvent } from "@/lib/notify/rules";

const NOW = Date.parse("2026-11-12T12:00:00Z");

function ev(over: Partial<RuleEvent & { countryName: string | null }> = {}) {
  return {
    id: "e1",
    type: "EARTHQUAKE",
    title: "M 6.4 earthquake near Honshu",
    summary: "Strong shaking reported; tsunami advisory issued.",
    country: "JP",
    countryName: "Japan",
    locationName: null,
    importanceScore: 70,
    status: "REPORTED",
    isSynthetic: false,
    sourceCount: 1,
    createdAt: new Date(NOW - 60_000).toISOString(),
    timestamp: new Date(NOW - 120_000).toISOString(),
    sources: [{ id: "usgs:us1", dataSourceId: "usgs", sourceName: "USGS", sourceUrl: "https://earthquake.usgs.gov/x" }],
    ...over,
  };
}
const rule = (over: Partial<AlertRule> = {}): AlertRule => ({ id: "r1", name: "Japan quakes", enabled: true, types: ["EARTHQUAKE"], countries: ["JP"], createdAt: new Date(NOW - 3_600_000).toISOString(), ...over });

describe("alert rules: schema", () => {
  it("needs at least one filter and normalises country codes", () => {
    expect(AlertRuleSchema.safeParse({ id: "a", name: "x", enabled: true }).success).toBe(false);
    const p = AlertRuleSchema.parse({ id: "a", name: " x ", enabled: true, countries: ["jp"] });
    expect(p.countries).toEqual(["JP"]);
    expect(p.name).toBe("x");
    expect(AlertRuleSchema.safeParse({ id: "a", name: "x", enabled: true, types: ["NOPE"] }).success).toBe(false);
    expect(AlertRuleSchema.safeParse({ id: "../etc", name: "x", enabled: true, minImportance: 5 }).success).toBe(false);
  });
  it("rejects duplicate ids", () => {
    expect(AlertRulesSchema.safeParse([rule(), rule()]).success).toBe(false);
  });
  it("keeps the stored createdAt and stamps new rules", () => {
    const stored = rule({ createdAt: "2026-01-01T00:00:00.000Z" });
    const [a, b] = stampRules([{ ...stored, createdAt: "2020-01-01T00:00:00.000Z" }, rule({ id: "r2", createdAt: undefined })], [stored], NOW);
    expect(a.createdAt).toBe("2026-01-01T00:00:00.000Z");
    expect(b.createdAt).toBe(new Date(NOW).toISOString());
  });
});

describe("alert rules: matching", () => {
  it("ANDs filters, ORs values", () => {
    expect(matchesRule(rule(), ev())).toBe(true);
    expect(matchesRule(rule({ countries: ["CL", "JP"] }), ev())).toBe(true);
    expect(matchesRule(rule({ countries: ["CL"] }), ev())).toBe(false);
    expect(matchesRule(rule({ types: ["FLOOD"] }), ev())).toBe(false);
    expect(matchesRule(rule({ minImportance: 80 }), ev())).toBe(false);
    expect(matchesRule(rule({ sources: ["emsc", "usgs"] }), ev())).toBe(true);
    expect(matchesRule(rule({ sources: ["emsc"] }), ev())).toBe(false);
  });
  it("matches keywords case-insensitively in title or summary", () => {
    expect(matchesRule(rule({ keywords: ["TSUNAMI"] }), ev())).toBe(true);
    expect(matchesRule(rule({ keywords: ["volcano", "honshu"] }), ev())).toBe(true);
    expect(matchesRule(rule({ keywords: ["volcano"] }), ev())).toBe(false);
  });
  it("events without a country never match a country rule", () => {
    expect(matchesRule(rule(), ev({ country: null }))).toBe(false);
  });
});

describe("alert rules: per-tick selection", () => {
  it("skips disabled rules, old events, resolved/synthetic events and already-sent keys", () => {
    const events = [
      ev({ id: "new" }),
      ev({ id: "old", createdAt: new Date(NOW - 7_200_000).toISOString(), sources: [{ id: "usgs:old", dataSourceId: "usgs" }] }),
      ev({ id: "res", status: "RESOLVED", sources: [{ id: "usgs:res", dataSourceId: "usgs" }] }),
      ev({ id: "syn", isSynthetic: true, sources: [{ id: "usgs:syn", dataSourceId: "usgs" }] }),
      ev({ id: "sent", sources: [{ id: "usgs:sent", dataSourceId: "usgs" }] }),
    ];
    const hits = selectRuleHits([rule(), rule({ id: "off", enabled: false })], events, new Set(["r1|sent"]));
    expect(hits).toHaveLength(1);
    expect(hits[0].events.map((e) => e.id)).toEqual(["new"]);
  });
  it("dedupes by source record so the sentinel's fresh ids don't repeat", () => {
    const sent = new Set(ruleKeys("r1", ev()));
    expect(selectRuleHits([rule()], [ev({ id: "different-id" })], sent)).toHaveLength(0);
    // …but another rule still gets it.
    expect(selectRuleHits([rule({ id: "r2" })], [ev()], sent)).toHaveLength(1);
  });
  it("caps per rule and per tick, most important first", () => {
    const many = Array.from({ length: 10 }, (_, i) => ev({ id: `e${i}`, importanceScore: 50 + i, sources: [{ id: `usgs:${i}`, dataSourceId: "usgs" }] }));
    const hits = selectRuleHits([rule(), rule({ id: "r2" })], many, new Set(), { maxPerRule: 4, maxTotal: 6 });
    expect(hits[0].events.map((e) => e.importanceScore)).toEqual([59, 58, 57, 56]);
    expect(hits[1].events).toHaveLength(2);
  });
});

describe("alert rules: storage and posting (fetch stubbed — nothing leaves the machine)", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "wv-rules-"));
  const calls: Array<{ url: string; body: { content: string; embeds: Array<{ title: string; description: string }> } }> = [];
  beforeAll(() => {
    process.env.DATA_DIR = dir;
    process.env.DISCORD_WEBHOOK_URL = "https://discord.com/api/webhooks/1/test-token";
    vi.stubGlobal("fetch", async (url: string, init: { body: string }) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return new Response(null, { status: 204 });
    });
  });
  afterAll(() => {
    vi.unstubAllGlobals();
    delete process.env.DISCORD_WEBHOOK_URL;
  });

  it("saves atomically, posts once per rule+event, escapes third-party text", async () => {
    const { saveRules, loadRules, postRuleAlerts } = await import("@/lib/notify/rules-server");
    const saved = await saveRules([rule({ name: "Japan *quakes*", createdAt: undefined })]);
    expect(saved[0].createdAt).toBeTruthy();
    expect(await loadRules()).toHaveLength(1);
    expect(readdirSync(dir).filter((f) => f.endsWith(".tmp"))).toEqual([]);

    const fresh = ev({ createdAt: new Date(Date.now() + 1000).toISOString(), summary: "Shaking [click](https://evil.example) *now*" });
    expect(await postRuleAlerts([fresh] as unknown as Parameters<typeof postRuleAlerts>[0])).toContain("posted");
    expect(calls).toHaveLength(1);
    expect(calls[0].body.content).toBe("**[WorldView]** 🔔 Japan \\*quakes\\*");
    expect(calls[0].body.embeds[0].description).toContain("\\[click\\]\\(https://evil.example\\)");
    // Second tick: already sent.
    expect(await postRuleAlerts([fresh] as unknown as Parameters<typeof postRuleAlerts>[0])).toContain("no new matches");
    expect(calls).toHaveLength(1);
    const state = JSON.parse(readFileSync(path.join(dir, "discord-state.json"), "utf8"));
    expect(state.ruleAlerted).toContain("r1|e1");
  });

  it("serialises concurrent read-modify-write updates of discord-state.json", async () => {
    const { update, load } = await import("@/lib/notify/discord-server");
    await Promise.all(Array.from({ length: 20 }, (_, i) => update((s) => ({ ...s, alerted: [...s.alerted, `k${i}`] }))));
    const s = await load();
    for (let i = 0; i < 20; i++) expect(s!.alerted).toContain(`k${i}`);
    expect(readdirSync(dir).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });
});
