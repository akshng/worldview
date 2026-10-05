import { describe, expect, it } from "vitest";
import { MACRO_SERIES, parseFearGreed, parseFredCsv, sparkOf, toIndicator, transformSeries } from "@/lib/finance/macro";

describe("FRED macro", () => {
  it("parses CSV and drops missing values", () => {
    expect(parseFredCsv("observation_date,X\n2026-01-01,1.5\n2026-01-02,.\n2026-01-05,2\n")).toEqual([
      { date: "2026-01-01", value: 1.5 },
      { date: "2026-01-05", value: 2 },
    ]);
  });
  it("computes year-over-year from the same month a year earlier", () => {
    const obs = [
      { date: "2025-08-01", value: 100 },
      { date: "2025-09-01", value: 100 },
      { date: "2026-08-01", value: 103 },
      { date: "2026-09-01", value: 102.5 },
    ];
    expect(transformSeries(obs, "yoy").map((o) => o.value.toFixed(1))).toEqual(["3.0", "2.5"]);
  });
  it("monthly change for payrolls", () => {
    const def = MACRO_SERIES.find((d) => d.id === "PAYEMS")!;
    const m = toIndicator(def, [
      { date: "2026-07-01", value: 160000 },
      { date: "2026-08-01", value: 160150 },
      { date: "2026-09-01", value: 160250 },
    ]);
    expect(m).toMatchObject({ value: 100, previous: 150, change: -50, asOf: "2026-09-01" });
  });
  it("samples daily series for sparklines", () => {
    const daily = Array.from({ length: 600 }, (_, i) => ({ date: new Date(Date.UTC(2025, 0, 1) + i * 86_400_000).toISOString().slice(0, 10), value: i }));
    const s = sparkOf(daily);
    expect(s.length).toBeLessThan(80);
    expect(s[s.length - 1]).toBe(599);
  });
  it("reads the crypto Fear & Greed index", () => {
    const m = parseFearGreed({ data: [{ value: "70", value_classification: "Greed", timestamp: "1791158400" }, { value: "65", value_classification: "Greed", timestamp: "1791072000" }] });
    expect(m).toMatchObject({ value: 70, change: 5, label: "Greed" });
  });
});
