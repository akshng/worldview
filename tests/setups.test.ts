import { describe, expect, it } from "vitest";
import { evaluate, metrics, pickSetups, rsi } from "@/lib/finance/setups";

const ramp = (n: number, from: number, to: number) => Array.from({ length: n }, (_, i) => from + ((to - from) * i) / (n - 1));

describe("stock setups", () => {
  it("computes RSI at the extremes", () => {
    expect(rsi(ramp(30, 10, 40))).toBe(100);
    expect(rsi(ramp(30, 40, 10))!).toBeLessThan(1);
  });
  it("flags a pullback in an uptrend", () => {
    // long rise 50→120, then a 15% slide
    const closes = [...ramp(220, 50, 120), ...ramp(15, 119, 102)];
    const s = evaluate("XYZ", "Xyz", metrics(closes)!);
    expect(s?.signals.join(" ")).toMatch(/Pullback in an uptrend/);
    expect(s!.score).toBeGreaterThanOrEqual(3);
  });
  it("treats a stock collapsing to new lows as risky, not a pullback", () => {
    const closes = [...ramp(200, 100, 100.5), ...ramp(40, 100, 45)];
    const s = evaluate("BAD", "Bad", metrics(closes)!)!;
    expect(s.signals.join(" ")).not.toMatch(/Pullback/);
    expect(s.risks.length).toBeGreaterThanOrEqual(2);
    expect(pickSetups([s], 3, 3)).toEqual([]);
  });
  it("returns nothing for a calm stock", () => {
    expect(evaluate("OK", "Ok", metrics(ramp(250, 100, 110))!)).toBeNull();
  });
});
