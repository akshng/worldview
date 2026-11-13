/**
 * Alert rules on the server: stored in DATA_DIR/alert-rules.json (written atomically),
 * evaluated by the server's Discord tick and by the battery sentinel, posted as
 * "[WorldView] 🔔 <rule name>" with one embed per event.
 */
import "server-only";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { env } from "@/lib/env";
import type { EventRepository } from "@/lib/db/types";
import { alertEmbed, discordWebhook, escapeMd, sendDiscord, type AlertEvent } from "./discord";
import { load, update } from "./discord-server";
import { AlertRuleSchema, ruleKeys, selectRuleHits, stampRules, type AlertRule, type RuleEvent } from "./rules";

const file = () => path.resolve(process.cwd(), env().DATA_DIR, "alert-rules.json");

export async function loadRules(): Promise<AlertRule[]> {
  try {
    const d = JSON.parse(await readFile(file(), "utf8")) as { rules?: unknown };
    if (!Array.isArray(d.rules)) return [];
    // Drop anything that no longer validates instead of failing every rule.
    return d.rules.flatMap((r) => {
      const p = AlertRuleSchema.safeParse(r);
      return p.success ? [p.data] : [];
    });
  } catch {
    return [];
  }
}

const g = globalThis as typeof globalThis & { __wvRulesQueue?: Promise<unknown> };

/** Replace the rule set (validated by the caller). Keeps each rule's original createdAt. */
export function saveRules(rules: AlertRule[]): Promise<AlertRule[]> {
  const run = (g.__wvRulesQueue ?? Promise.resolve()).then(async () => {
    const stamped = stampRules(rules, await loadRules());
    const target = file();
    await mkdir(path.dirname(target), { recursive: true });
    const tmp = `${target}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
    try {
      await writeFile(tmp, JSON.stringify({ rules: stamped, updatedAt: new Date().toISOString() }, null, 1));
      await rename(tmp, target);
    } catch (e) {
      await unlink(tmp).catch(() => {});
      throw e;
    }
    return stamped;
  });
  g.__wvRulesQueue = run.catch(() => undefined);
  return run;
}

type Postable = RuleEvent & AlertEvent;

/** Post new rule matches among `events`. Returns a log line. Never posts without a webhook. */
export async function postRuleAlerts(events: Postable[]): Promise<string> {
  if (!discordWebhook()) return "alert rules: no webhook";
  const rules = (await loadRules()).filter((r) => r.enabled);
  if (!rules.length) return "alert rules: none enabled";
  const state = await load();
  const hits = selectRuleHits(rules, events, new Set(state?.ruleAlerted ?? []));
  if (!hits.length) return `alert rules: ${rules.length} checked, no new matches`;
  const posted: string[] = [];
  for (const h of hits) {
    try {
      await sendDiscord(`**[WorldView]** 🔔 ${escapeMd(h.rule.name)}${h.events.length > 1 ? ` · ${h.events.length} new events` : ""}`, h.events.map((e) => alertEmbed(e)));
    } catch (e) {
      // Leave unsent hits for the next tick.
      console.warn(`[discord] rule "${h.rule.name}":`, e instanceof Error ? e.message : e);
      continue;
    }
    const keys = h.events.flatMap((e) => ruleKeys(h.rule.id, e));
    await update((s) => ({ ...s, ruleAlerted: [...(s.ruleAlerted ?? []), ...keys] }));
    posted.push(`${h.rule.name} (${h.events.length})`);
  }
  return posted.length ? `alert rules: posted ${posted.join(", ")}` : "alert rules: post failed";
}

const WINDOW_MS = 6 * 3_600_000;

/** Server tick: rule matches among events from the last 6 hours. */
export async function ruleAlertsFromRepo(repo: EventRepository, now = Date.now()): Promise<string> {
  if (!discordWebhook()) return "alert rules: no webhook";
  if (!(await loadRules()).some((r) => r.enabled)) return "alert rules: none enabled";
  return postRuleAlerts(await repo.scan({ from: new Date(now - WINDOW_MS).toISOString() }));
}

/** "Test rule": how many of the last 24 h's events match (ignores enabled / createdAt). Never posts. */
export async function testRule(repo: EventRepository, rule: AlertRule, now = Date.now()) {
  const { matchesRule } = await import("./rules");
  const events = (await repo.scan({ from: new Date(now - 86_400_000).toISOString() })).filter((e) => !e.isSynthetic);
  const hits = events.filter((e) => matchesRule(rule, e)).sort((a, b) => b.importanceScore - a.importanceScore);
  return {
    total: events.length,
    matched: hits.length,
    sample: hits.slice(0, 5).map((e) => ({ id: e.id, title: e.title, type: e.type, importanceScore: e.importanceScore, countryName: e.countryName, timestamp: e.timestamp })),
  };
}
