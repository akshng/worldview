/** Logs posted setups and scores them (live + backtest). Files under DATA_DIR/setups/. */
import "server-only";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { env } from "@/lib/env";
import { getHistory } from "./service";
import { SETUP_UNIVERSE, type Setup } from "./setups";
import { backtest, forwardReturns, summarize, type BacktestResult, type Forward, type LoggedPick, type ScoreSummary } from "./setups-score";

const dir = () => path.resolve(process.cwd(), env().DATA_DIR, "setups");
async function readJson<T>(name: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path.join(dir(), name), "utf8")) as T;
  } catch {
    return null;
  }
}
async function writeJson(name: string, v: unknown) {
  await mkdir(dir(), { recursive: true });
  await writeFile(path.join(dir(), name), JSON.stringify(v, null, 1));
}

/** Remember posted picks so they can be scored later (one entry per symbol per day). */
export async function recordPicks(setups: Setup[], date: string) {
  const log = (await readJson<LoggedPick[]>("picks.json")) ?? [];
  for (const s of setups) {
    if (log.some((p) => p.symbol === s.symbol && p.date === date)) continue;
    log.push({ date, symbol: s.symbol, name: s.name, price: s.metrics.price, score: s.score, signals: s.signals });
  }
  await writeJson("picks.json", log);
}

export interface LiveScorecard {
  summary: ScoreSummary;
  picks: Array<LoggedPick & Forward>;
}

export async function liveScorecard(): Promise<LiveScorecard> {
  const log = (await readJson<LoggedPick[]>("picks.json")) ?? [];
  if (!log.length) return { summary: summarize([]), picks: [] };
  const spx = (await getHistory("^GSPC", "6mo")).points;
  const picks = await Promise.all(
    log.map(async (p) => {
      try {
        return { ...p, ...forwardReturns((await getHistory(p.symbol, "6mo")).points, spx, p.date) };
      } catch {
        return { ...p, r1: null, r5: null, r21: null, x1: null, x5: null, x21: null };
      }
    }),
  );
  return { summary: summarize(picks), picks: picks.sort((a, b) => b.date.localeCompare(a.date)) };
}

/** Backtest of the price rules over ~2 years of daily closes (cached a day). */
export async function backtestSetups(force = false): Promise<BacktestResult & { generatedAt: string }> {
  const minScore = env().SETUP_MIN_SCORE;
  const cached = await readJson<BacktestResult & { generatedAt: string }>("backtest.json");
  if (!force && cached && cached.minScore === minScore && Date.now() - Date.parse(cached.generatedAt) < 86_400_000) return cached;
  const spx = (await getHistory("^GSPC", "2y")).points;
  const series: Array<{ symbol: string; points: Array<[number, number]> }> = [];
  for (let i = 0; i < SETUP_UNIVERSE.length; i += 6) {
    const batch = await Promise.all(SETUP_UNIVERSE.slice(i, i + 6).map((s) => getHistory(s, "2y").then((h) => ({ symbol: s, points: h.points })).catch(() => null)));
    series.push(...batch.filter((b): b is NonNullable<typeof b> => b !== null && b.points.length > 260));
  }
  const result = { ...backtest(series, spx, minScore), generatedAt: new Date().toISOString() };
  await writeJson("backtest.json", result).catch(() => {});
  return result;
}
