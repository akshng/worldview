/**
 * Prune on-disk caches under DATA_DIR by age and count, so they can't grow forever:
 *
 *   insiders/*.json          parsed Form 4 filings: only the last 90 days are ever read → 180 d, max 3000
 *   13f/filing-*.json        parsed 13F filings: only the latest two periods are used → 540 d, max 600
 *   13f/submissions-*.json   refreshed every 24 h anyway → 30 d
 *   filings/*.json           cached 10-K analyses → 365 d, max 300
 *
 * The briefing archive (briefings/), setups scorecard, watchlist, event store and the AI
 * model are never touched. Runs once at server start (src/instrumentation.ts).
 * No "server-only" import so tests can use it directly.
 */
import { readdir, rm, stat } from "node:fs/promises";
import path from "node:path";

export interface PruneRule {
  /** Directory relative to DATA_DIR */
  dir: string;
  match: RegExp;
  maxAgeMs?: number;
  maxFiles?: number;
}

const DAY = 86_400_000;
export const CACHE_PRUNE_RULES: PruneRule[] = [
  { dir: "insiders", match: /^[\w-]+\.json$/, maxAgeMs: 180 * DAY, maxFiles: 3000 },
  { dir: "13f", match: /^filing-[\w-]+\.json$/, maxAgeMs: 540 * DAY, maxFiles: 600 },
  { dir: "13f", match: /^submissions-[\w-]+\.json$/, maxAgeMs: 30 * DAY },
  { dir: "filings", match: /^[\w-]+\.json$/, maxAgeMs: 365 * DAY, maxFiles: 300 },
];

/** Which files (name + mtime) a rule removes: too old, then the oldest beyond maxFiles. Pure. */
export function filesToPrune(files: Array<{ name: string; mtimeMs: number }>, rule: Pick<PruneRule, "match" | "maxAgeMs" | "maxFiles">, now = Date.now()): string[] {
  const matching = files.filter((f) => rule.match.test(f.name)).sort((a, b) => b.mtimeMs - a.mtimeMs);
  const drop = new Set<string>();
  matching.forEach((f, i) => {
    if (rule.maxAgeMs !== undefined && now - f.mtimeMs > rule.maxAgeMs) drop.add(f.name);
    else if (rule.maxFiles !== undefined && i >= rule.maxFiles) drop.add(f.name);
  });
  return [...drop];
}

export async function pruneCaches(dataDir: string, rules = CACHE_PRUNE_RULES, now = Date.now()): Promise<number> {
  let removed = 0;
  for (const rule of rules) {
    const dir = path.resolve(dataDir, rule.dir);
    let names: string[];
    try {
      names = await readdir(dir);
    } catch {
      continue; // cache not created yet
    }
    const files: Array<{ name: string; mtimeMs: number }> = [];
    for (const name of names) {
      if (!rule.match.test(name)) continue;
      try {
        files.push({ name, mtimeMs: (await stat(path.join(dir, name))).mtimeMs });
      } catch {
        /* vanished */
      }
    }
    for (const name of filesToPrune(files, rule, now)) {
      await rm(path.join(dir, name), { force: true }).catch(() => {});
      removed++;
    }
  }
  return removed;
}
