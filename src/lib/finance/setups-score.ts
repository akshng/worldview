/**
 * Scorecard for the stock-setups scan: how flagged stocks did afterwards versus
 * the S&P 500, both for the live picks posted to Discord and in a backtest of the
 * same price rules over the last ~2 years. Pure functions; the service fetches prices.
 */
import { evaluate, metrics } from "./setups";

export interface LoggedPick {
  date: string; // NY date the pick was posted (YYYY-MM-DD)
  symbol: string;
  name: string;
  price: number;
  score: number;
  signals: string[];
}

export interface Forward {
  r1: number | null;
  r5: number | null;
  r21: number | null;
  /** excess return vs the S&P 500 over the same days (percentage points) */
  x1: number | null;
  x5: number | null;
  x21: number | null;
}

export const HORIZONS = [1, 5, 21] as const;
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const pct = (a: number, b: number) => ((b - a) / a) * 100;

/** Returns from the close on (or the first close after) `date`, 1/5/21 trading days later. */
export function forwardReturns(points: Array<[number, number]>, spx: Array<[number, number]>, date: string): Forward {
  const out: Forward = { r1: null, r5: null, r21: null, x1: null, x5: null, x21: null };
  const i = points.findIndex(([t]) => day(t) >= date);
  if (i < 0) return out;
  const spxBy = new Map(spx.map(([t, c]) => [day(t), c]));
  const base = points[i][1];
  const spxBase = spxBy.get(day(points[i][0]));
  for (const k of HORIZONS) {
    const j = points[i + k];
    if (!j) continue;
    const r = pct(base, j[1]);
    out[`r${k}`] = r;
    const s = spxBy.get(day(j[0]));
    if (spxBase && s) out[`x${k}`] = r - pct(spxBase, s);
  }
  return out;
}

export interface ScoreSummary {
  n: number;
  /** per horizon: how many have that horizon yet, average excess vs S&P, share that beat the S&P */
  horizons: Array<{ days: number; n: number; avgExcess: number | null; beatRate: number | null; avgReturn: number | null }>;
}

export function summarize(rows: Forward[]): ScoreSummary {
  return {
    n: rows.length,
    horizons: HORIZONS.map((k) => {
      const xs = rows.map((r) => r[`x${k}`]).filter((v): v is number => v !== null);
      const rs = rows.map((r) => r[`r${k}`]).filter((v): v is number => v !== null);
      const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
      return { days: k, n: xs.length, avgExcess: avg(xs), beatRate: xs.length ? xs.filter((v) => v > 0).length / xs.length : null, avgReturn: avg(rs) };
    }),
  };
}

export interface BacktestResult {
  from: string | null;
  to: string | null;
  stocks: number;
  signals: ScoreSummary;
  /** the same stocks on every tested day, for comparison: what "no signal" earned */
  baseline: ScoreSummary;
  minScore: number;
  caveats: string[];
}

/**
 * Replays the price rules day by day (no look-ahead: each day sees only earlier
 * closes). A stock can't re-trigger for `cooldown` trading days, so one slide
 * counts once. Insider buying is left out (no point-in-time history here).
 */
export function backtest(series: Array<{ symbol: string; points: Array<[number, number]> }>, spx: Array<[number, number]>, minScore: number, cooldown = 10): BacktestResult {
  const hits: Forward[] = [];
  const base: Forward[] = [];
  let from: string | null = null;
  let to: string | null = null;
  for (const { symbol, points } of series) {
    const closes = points.map((p) => p[1]);
    let quietUntil = -1;
    for (let t = 200; t < closes.length - 1; t++) {
      const date = day(points[t][0]);
      if (!from || date < from) from = date;
      if (!to || date > to) to = date;
      const f = forwardReturns(points.slice(t), spx, date);
      if (t % 5 === 0) base.push(f); // sample every 5th day: plenty for an average
      if (t < quietUntil) continue;
      const m = metrics(closes.slice(Math.max(0, t - 251), t + 1));
      const s = m && evaluate(symbol, symbol, m);
      if (s && s.score >= minScore) {
        hits.push(f);
        quietUntil = t + cooldown;
      }
    }
  }
  return {
    from,
    to,
    stocks: series.length,
    signals: summarize(hits),
    baseline: summarize(base),
    minScore,
    caveats: [
      "Survivorship bias: the universe is today's large companies, so stocks that collapsed or were delisted are missing (flatters results).",
      "Uses closing prices only; ignores trading costs, taxes and slippage.",
      "Insider buying isn't in the backtest (price rules only).",
      "About two years of data: a small sample from one market environment. Past results don't predict future ones.",
    ],
  };
}
