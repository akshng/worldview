import { describe, expect, it } from "vitest";
import { backtest, forwardReturns, summarize } from "@/lib/finance/setups-score";

const DAY = 86_400_000;
const series = (vals: number[], start = Date.UTC(2025, 0, 1)) => vals.map((v, i) => [start + i * DAY, v] as [number, number]);

describe("setups scorecard", () => {
  it("measures returns and excess vs the S&P from the pick date", () => {
    const stock = series(Array.from({ length: 30 }, (_, i) => 100 + i)); // +1/day
    const spx = series(Array.from({ length: 30 }, () => 5000)); // flat
    const f = forwardReturns(stock, spx, "2025-01-01");
    expect(f.r1).toBeCloseTo(1);
    expect(f.r5).toBeCloseTo(5);
    expect(f.x21).toBeCloseTo(21);
  });
  it("leaves horizons that haven't happened yet empty", () => {
    const f = forwardReturns(series([100, 101, 102]), series([1, 1, 1]), "2025-01-01");
    expect(f.r1).not.toBeNull();
    expect(f.r5).toBeNull();
  });
  it("summarizes beat rate", () => {
    const s = summarize([{ r1: 1, r5: 2, r21: 3, x1: 1, x5: 1, x21: -1 }, { r1: 1, r5: 2, r21: 3, x1: 1, x5: -1, x21: -1 }]);
    expect(s.horizons.find((h) => h.days === 5)!.beatRate).toBe(0.5);
    expect(s.horizons.find((h) => h.days === 21)!.avgExcess).toBe(-1);
  });
  it("backtests without look-ahead and with a cooldown", () => {
    // long rise, a pullback, then recovery
    const up = Array.from({ length: 230 }, (_, i) => 50 + i * 0.3);
    const dip = Array.from({ length: 15 }, (_, i) => up[up.length - 1] * (1 - 0.012 * (i + 1)));
    const rec = Array.from({ length: 40 }, (_, i) => dip[dip.length - 1] * (1 + 0.004 * (i + 1)));
    const pts = series([...up, ...dip, ...rec]);
    const r = backtest([{ symbol: "X", points: pts }], series(pts.map(() => 1)), 3);
    expect(r.signals.n).toBeGreaterThan(0);
    expect(r.signals.n).toBeLessThan(4); // cooldown: one slide counts ~once
    expect(r.signals.horizons.find((h) => h.days === 21)!.avgReturn!).toBeGreaterThan(0);
  });
});
