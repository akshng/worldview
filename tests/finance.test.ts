import { describe, expect, it } from "vitest";
import { marketExposure, marketMovers } from "@/lib/finance/exposure";
import { parseTreasuryCsv } from "@/lib/finance/providers";

const ev = (o: Partial<Parameters<typeof marketExposure>[0]> & { id?: string }) => ({
  id: "x",
  type: "CONFLICT" as const,
  subtype: null,
  title: "Clashes reported",
  country: "YE",
  latitude: 15,
  longitude: 44,
  importanceScore: 50,
  metrics: {},
  status: "REPORTED" as const,
  ...o,
});

describe("market exposure rules", () => {
  it("links corroborated Gulf conflict to oil", () => {
    expect(marketExposure(ev({})).map((l) => l.symbol)).toEqual(expect.arrayContaining(["BZ=F", "CL=F"]));
  });
  it("ignores single-source machine-coded news", () => {
    expect(marketExposure(ev({ status: "UNVERIFIED" }))).toEqual([]);
  });
  it("links SEC filings to the filer's ticker", () => {
    expect(marketExposure(ev({ type: "BUSINESS", subtype: "sec-8k", country: "US", metrics: { ticker: "ACME" } }))[0]).toMatchObject({ symbol: "ACME" });
  });
  it("links major Japanese quakes to the Nikkei and yen", () => {
    const l = marketExposure(ev({ type: "EARTHQUAKE", country: "JP", latitude: 38, longitude: 142, metrics: { magnitude: 7.1 }, status: "CONFIRMED" }));
    expect(l.map((x) => x.symbol)).toEqual(expect.arrayContaining(["^N225", "USDJPY=X"]));
  });
  it("does not treat routine Brazilian burning as crop risk", () => {
    expect(marketExposure(ev({ type: "FIRE", country: "BR", metrics: { frp_total_mw: 800 }, importanceScore: 50 }))).toEqual([]);
    expect(marketExposure(ev({ type: "FIRE", country: "BR", metrics: { frp_total_mw: 9000 } })).map((l) => l.symbol)).toContain("KC=F");
  });
  it("links Gulf of Mexico hurricanes to energy", () => {
    expect(marketExposure(ev({ type: "WEATHER", subtype: "tropical-cyclone", country: "US", latitude: 26, longitude: -90 })).map((l) => l.symbol)).toContain("NG=F");
  });
  it("keeps the movers list diverse", () => {
    const many = Array.from({ length: 5 }, (_, i) => ev({ id: String(i), importanceScore: 60 - i }));
    expect(marketMovers(many)).toHaveLength(2);
  });
});

describe("treasury CSV", () => {
  it("parses dates and tenors", () => {
    const csv = `Date,"1 Mo","2 Yr","10 Yr","30 Yr"\n10/02/2026,4.9,4.83,5.28,5.63\n10/01/2026,4.9,4.78,5.24,5.61`;
    expect(parseTreasuryCsv(csv)[0]).toEqual({ date: "2026-10-02", y2: 4.83, y10: 5.28, y30: 5.63 });
  });
});

describe("economic calendar", async () => {
  const { parseBlsIcs, parseBea, easternToUtc, importanceOf } = await import("@/lib/finance/calendar");
  it("converts US-Eastern release times across DST", () => {
    expect(easternToUtc(2026, 10, 2, 8, 30).toISOString()).toBe("2026-10-02T12:30:00.000Z"); // EDT
    expect(easternToUtc(2026, 12, 4, 8, 30).toISOString()).toBe("2026-12-04T13:30:00.000Z"); // EST
  });
  it("parses BLS ICS events and flags market-moving releases", () => {
    const ics = "BEGIN:VEVENT\r\nDTSTART;TZID=US-Eastern:20261002T083000\r\nSUMMARY:Employment Situation\r\nUID:a\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nDTSTART;TZID=US-Eastern:20261014T083000\r\nSUMMARY:Consumer Price Index\r\nUID:b\r\nEND:VEVENT";
    const items = parseBlsIcs(ics);
    expect(items.map((i) => [i.title, i.importance, i.at])).toEqual([
      ["Employment Situation", "high", "2026-10-02T12:30:00.000Z"],
      ["Consumer Price Index", "high", "2026-10-14T12:30:00.000Z"],
    ]);
  });
  it("parses BEA dates and de-prioritises minor releases", () => {
    const items = parseBea({ "Gross Domestic Product": { release_dates: ["2026-10-29T12:30:00+00:00"] }, file_last_updated: "x" });
    expect(items[0]).toMatchObject({ agency: "BEA", importance: "high" });
    expect(importanceOf("Travel and Tourism Satellite Account")).toBe("low");
  });
});

describe("SEC fundamentals", async () => {
  const { latestQuarter } = await import("@/lib/finance/company");
  it("picks the latest calendar quarter and the same quarter a year earlier", () => {
    const rows = [
      { end: "2025-06-28", val: 94, fy: 2025, fp: "Q3", form: "10-Q", filed: "x", frame: "CY2025Q2" },
      { end: "2026-06-27", val: 109, fy: 2026, fp: "Q3", form: "10-Q", filed: "y", frame: "CY2026Q2" },
      { end: "2026-06-27", val: 300, fy: 2026, fp: "Q3", form: "10-Q", filed: "y" }, // year-to-date, no frame
    ];
    const lq = latestQuarter(rows)!;
    expect([lq.cur.val, lq.prior?.val]).toEqual([109, 94]);
  });
});
