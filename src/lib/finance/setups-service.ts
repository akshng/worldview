/** Runs the setups scan against live (delayed) prices and asks the AI for a balanced note on each hit. */
import "server-only";
import { env } from "@/lib/env";
import { getHistory } from "./service";
import { getScreener } from "./screeners";
import { SETUP_UNIVERSE, evaluate, metrics, pickSetups, type Setup } from "./setups";

async function mapLimit<T, R>(xs: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(xs.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, xs.length) }, async () => {
    while (i < xs.length) {
      const k = i++;
      out[k] = await fn(xs[k]);
    }
  }));
  return out;
}

export function setupUniverse(extra: string[] = []): string[] {
  const watch = (env().SETUP_WATCHLIST ?? "").split(",").map((s) => s.trim().toUpperCase()).filter((s) => /^[A-Z0-9.^=-]{1,12}$/.test(s));
  return [...new Set([...SETUP_UNIVERSE, ...watch, ...extra])];
}

export async function scanSetups(opts: { max?: number; minScore?: number } = {}): Promise<{ setups: Setup[]; scanned: number; failed: number; asOf: string }> {
  // Today's large-cap losers / most active join the fixed universe.
  const lists = await Promise.all([getScreener("losers").catch(() => null), getScreener("active").catch(() => null)]);
  const extra = lists.flatMap((l) => l?.rows ?? []).filter((r) => (r.marketCap ?? 0) >= 10e9).map((r) => r.symbol);
  const universe = setupUniverse(extra);
  let failed = 0;
  const hits = await mapLimit(universe, 6, async (sym) => {
    try {
      const h = await getHistory(sym, "1y");
      const m = metrics(h.points.map((p) => p[1]));
      return m ? evaluate(sym, h.name || sym, m) : null;
    } catch {
      failed++;
      return null;
    }
  });
  const setups = pickSetups(hits.filter((s): s is Setup => s !== null), opts.minScore ?? env().SETUP_MIN_SCORE, opts.max ?? 3);
  for (const s of setups) {
    try {
      const { holdersOf } = await import("./thirteenf-service");
      const r = await Promise.race([holdersOf(s.symbol), new Promise<null>((res) => setTimeout(() => res(null), 20_000))]);
      s.funds = r ? r.holders.length : null;
    } catch {
      s.funds = null;
    }
  }
  return { setups, scanned: universe.length, failed, asOf: new Date().toISOString() };
}

/** Adds an AI note to each setup (falls back to the rule text if AI is off or fails), then frees the local model. */
export async function annotateSetups(setups: Setup[]): Promise<string | null> {
  if (!setups.length) return null;
  const { getAIProvider, getLocalProvider } = await import("@/lib/ai");
  const ai = getAIProvider();
  if (!ai) return null;
  try {
    for (const s of setups) {
      try {
        s.note = await ai.writeSetupNote(s);
      } catch (e) {
        console.warn(`[setups] AI note for ${s.symbol} failed:`, e instanceof Error ? e.message : e);
      }
    }
  } finally {
    await getLocalProvider()?.unload().catch(() => false);
  }
  return `${ai.name} (${ai.model})`;
}
