import { describe, expect, it } from "vitest";
import { parseEarnings } from "@/lib/finance/earnings";
import { assembleCurve, contractSymbols, curveShape, parseChartPrice } from "@/lib/finance/term-structure";
import { parseDividends } from "@/lib/finance/dividends";
import { latestInstant, quarterlyHistory } from "@/lib/finance/company";
import { MACRO_SERIES, diffSeries, parseTga } from "@/lib/finance/macro";

describe("earnings releases (8-K Item 2.02)", () => {
  const hit = (id: string, src: Record<string, unknown>) => ({ _id: id, _source: { form: "8-K", root_forms: ["8-K"], ...src } });
  const hits = [
    hit("0000723125-26-000018:mu-20260930.htm", { adsh: "0000723125-26-000018", file_date: "2026-09-30", period_ending: "2026-09-30", items: ["2.02", "9.01"], display_names: ["MICRON TECHNOLOGY INC  (MU)  (CIK 0000723125)"], biz_locations: ["Boise, ID"] }),
    // exhibit of the same filing → deduplicated
    hit("0000723125-26-000018:ex99.htm", { adsh: "0000723125-26-000018", file_date: "2026-09-30", items: ["2.02", "9.01"], display_names: ["MICRON TECHNOLOGY INC  (MU)  (CIK 0000723125)"] }),
    // mentions "Item 2.02" in text but doesn't declare it → dropped
    hit("0001-26-1:x.htm", { adsh: "0001-26-1", file_date: "2026-10-01", items: ["8.01"], display_names: ["Other Co  (OTH)  (CIK 0000000001)"] }),
    hit("0001858681-26-000054:apo-20261005.htm", { adsh: "0001858681-26-000054", file_date: "2026-10-05", items: ["2.02", "7.01"], display_names: ["Apollo Global Management, Inc.  (APO, APOS)  (CIK 0001858681)"] }),
    hit("0002-26-2:p.htm", { adsh: "0002-26-2", file_date: "2026-10-02", items: ["2.02"], display_names: ["Private Lender LLC  (CIK 0000000099)"] }),
  ];
  it("keeps one row per Item 2.02 filing, newest first, with ticker and link", () => {
    const r = parseEarnings(hits as never);
    expect(r.map((x) => x.ticker)).toEqual(["APO", null, "MU"]);
    expect(r[0]).toMatchObject({ company: "Apollo Global Management, Inc.", cik: "1858681", filed: "2026-10-05", otherItems: ["7.01"] });
    expect(r[2].url).toBe("https://www.sec.gov/Archives/edgar/data/723125/000072312526000018/mu-20260930.htm");
    expect(r[2].location).toBe("Boise, ID");
  });
});

describe("futures term structure", () => {
  it("builds consecutive contract symbols across the year end", () => {
    const legs = contractSymbols({ root: "CL", exchange: "NYM", count: 3 }, new Date(Date.UTC(2026, 10, 15)));
    expect(legs).toEqual([
      { symbol: "CLX26.NYM", label: "Nov 26", x: 0 },
      { symbol: "CLZ26.NYM", label: "Dec 26", x: 1 },
      { symbol: "CLF27.NYM", label: "Jan 27", x: 2 },
      { symbol: "CLG27.NYM", label: "Feb 27", x: 3 },
    ]);
  });
  it("uses only listed months and can skip the current month", () => {
    const legs = contractSymbols({ root: "GC", exchange: "CMX", months: "GJMQVZ", skipCurrent: true, count: 2 }, new Date(Date.UTC(2026, 9, 6)));
    expect(legs.map((l) => [l.symbol, l.x])).toEqual([["GCZ26.CMX", 2], ["GCG27.CMX", 4], ["GCJ27.CMX", 6]]);
  });
  it("reads price and time from a chart response", () => {
    expect(parseChartPrice({ chart: { result: [{ meta: { regularMarketPrice: 88.63, regularMarketTime: 1_791_300_000 } }] } })).toEqual({ price: 88.63, time: 1_791_300_000_000 });
    expect(parseChartPrice({ chart: { result: null, error: { code: "Not Found" } } })).toBeNull();
    expect(parseChartPrice({ chart: { result: [{ meta: { regularMarketPrice: 0 } }] } })).toBeNull();
  });
  it("classifies the slope", () => {
    expect(curveShape([{ price: 89.56 }, { price: 77.8 }])).toEqual({ slopePct: -13.1, shape: "backwardation" });
    expect(curveShape([{ price: 4204.3 }, { price: 4362 }])).toEqual({ slopePct: 3.8, shape: "contango" });
    expect(curveShape([{ price: 100 }, { price: 100.5 }]).shape).toBe("flat");
    expect(curveShape([{ price: 1 }])).toEqual({ slopePct: null, shape: null });
  });
  it("drops stale contracts and caps the count", () => {
    const t = 1_791_300_000_000;
    const raw = [
      { symbol: "A", label: "Nov 26", x: 0, price: 10, time: t - 20 * 86_400_000 }, // stopped trading weeks ago
      { symbol: "B", label: "Dec 26", x: 1, price: 11, time: t },
      { symbol: "C", label: "Jan 27", x: 2, price: 12.3456, time: t },
      { symbol: "D", label: "Feb 27", x: 3, price: 13, time: t },
    ];
    const c = assembleCurve(raw, 2);
    expect(c.map((p) => p.symbol)).toEqual(["B", "C"]);
    expect(c[1].price).toBe(12.346);
  });
});

describe("dividends", () => {
  const now = Date.UTC(2026, 9, 6);
  const fixture = {
    chart: {
      result: [
        {
          meta: { regularMarketPrice: 86.4, currency: "USD" },
          events: {
            dividends: {
              "1730433600": { amount: 0.485, date: 1732890600 }, // 2024-11-29
              "1748750400": { amount: 0.51, date: 1749821400 }, // 2025-06-13
              "1764565200": { amount: 0.51, date: 1764599400 }, // 2025-12-01
              "1772341200": { amount: 0.53, date: 1773408600 }, // 2026-03-13
              "1780286400": { amount: 0.53, date: 1781530200 }, // 2026-06-15
              "1788235200": { amount: 0.53, date: 1789479000 }, // 2026-09-15
              bad: { amount: -1, date: 1789479000 },
            },
          },
        },
      ],
    },
  };
  it("uses the ex-date (not the bucket key), sums the trailing year and computes yield", () => {
    const d = parseDividends("KO", fixture, now);
    expect(d.payments[0]).toEqual({ exDate: "2024-11-29", amount: 0.485 });
    expect(d.payments).toHaveLength(6);
    expect(d.ttm).toBe(2.1);
    expect(d.yieldPct).toBe(2.43);
    expect(d.currency).toBe("USD");
  });
  it("returns an empty history for non-payers", () => {
    const d = parseDividends("^GSPC", { chart: { result: [{ meta: { regularMarketPrice: 7800 } }] } }, now);
    expect(d).toMatchObject({ payments: [], ttm: null, yieldPct: null, perYear: null });
  });
});

describe("SEC company facts extras", () => {
  const row = (start: string | undefined, end: string, val: number, form = "10-Q", filed = "2026-01-01") => ({ start, end, val, form, filed, fy: 2026, fp: "Q1" });
  it("picks the latest point-in-time value from periodic reports", () => {
    const r = latestInstant([row(undefined, "2025-12-27", 1), row(undefined, "2026-06-27", 3, "10-Q", "2026-08-01"), row(undefined, "2026-06-27", 2, "10-Q", "2026-07-31"), row(undefined, "2026-09-30", 9, "8-K")]);
    expect(r?.val).toBe(3);
    expect(latestInstant([row("2026-01-01", "2026-03-31", 5)])).toBeNull();
  });
  it("derives the missing fourth quarter from the annual total", () => {
    const rows = [
      row("2024-09-29", "2024-12-28", 124.3),
      row("2024-12-29", "2025-03-29", 95.4),
      row("2025-03-30", "2025-06-28", 94.0),
      row("2024-09-29", "2025-09-27", 416.2, "10-K", "2025-10-31"),
      // year-to-date (6-month) values are ignored
      row("2024-09-29", "2025-03-29", 219.7),
      row("2025-09-28", "2025-12-27", 143.8),
    ];
    const h = quarterlyHistory(rows);
    expect(h.map((q) => q.end)).toEqual(["2024-12-28", "2025-03-29", "2025-06-28", "2025-09-27", "2025-12-27"]);
    expect(h[3].derived).toBe(true);
    expect(h[3].value).toBeCloseTo(102.5, 6);
    expect(h.filter((q) => q.derived)).toHaveLength(1);
  });
});

describe("macro additions", () => {
  it("computes a spread on matching dates", () => {
    expect(diffSeries([{ date: "2026-07-01", value: 3.88 }, { date: "2026-08-01", value: 3.99 }], [{ date: "2026-08-01", value: 3.18 }])).toEqual([{ date: "2026-08-01", value: 3.99 - 3.18 }]);
  });
  it("parses the TGA closing balance from the Daily Treasury Statement", () => {
    const j = {
      data: [
        { record_date: "2026-10-02", account_type: "Treasury General Account (TGA) Closing Balance", open_today_bal: "871181", close_today_bal: "null" },
        { record_date: "2026-10-02", account_type: "Total TGA Deposits (Table II)", open_today_bal: "20416", close_today_bal: "null" },
        { record_date: "2026-10-01", account_type: "Treasury General Account (TGA) Closing Balance", open_today_bal: "1", close_today_bal: "893699" },
      ],
    };
    expect(parseTga(j)).toEqual([
      { date: "2026-10-02", value: 871.181 },
      { date: "2026-10-01", value: 893.699 },
    ]);
  });
  it("has unique ids and the new global series", () => {
    const ids = MACRO_SERIES.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ["IRLTLT01FRM156N", "IRLTLT01ITM156N", "IT_DE_10Y", "RRPONTSYD", "SOFR"]) expect(ids).toContain(id);
    expect(MACRO_SERIES.find((d) => d.id === "IT_DE_10Y")).toMatchObject({ fred: "IRLTLT01ITM156N", minus: "IRLTLT01DEM156N", group: "Global" });
  });
});

import { annualReports } from "@/lib/finance/company";

describe("annual reports (10-K)", () => {
  it("keeps 10-K / 20-F filings with period, document and index links", () => {
    const r = {
      form: ["8-K", "10-K", "10-Q", "10-K/A", "20-F"],
      accessionNumber: ["0000320193-26-000001", "0000320193-25-000079", "x", "0000320193-24-000010", "0001234567-23-000002"],
      filingDate: ["2026-01-30", "2025-10-31", "2025-08-01", "2024-03-01", "2023-04-01"],
      reportDate: ["2026-01-29", "2025-09-27", "2025-06-28", "2023-09-30", ""],
      primaryDocument: ["a.htm", "aapl-20250927.htm", "q.htm", "amend.htm", "f20.htm"],
    };
    const out = annualReports("0000320193", r);
    expect(out.map((a) => a.form)).toEqual(["10-K", "10-K/A", "20-F"]);
    expect(out[0]).toMatchObject({
      period: "2025-09-27",
      url: "https://www.sec.gov/Archives/edgar/data/320193/000032019325000079/aapl-20250927.htm",
      indexUrl: "https://www.sec.gov/Archives/edgar/data/320193/000032019325000079/0000320193-25-000079-index.htm",
    });
    expect(out[2].period).toBeNull();
  });
});
