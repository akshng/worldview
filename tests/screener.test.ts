import { describe, expect, it } from "vitest";
import { parseScreener } from "@/lib/finance/screeners";
import { parseDebtToPenny, parseMtsYtd, seriesIndicator } from "@/lib/finance/macro";

describe("stock screener", () => {
  it("keeps equities with safe symbols, sorted for the list", () => {
    const j = { finance: { result: [{ quotes: [
      { symbol: "XP", shortName: "XP Inc.", regularMarketPrice: 28.4, regularMarketChangePercent: 31.9, quoteType: "EQUITY" },
      { symbol: "PTC", shortName: "PTC Inc.", regularMarketPrice: 192.6, regularMarketChangePercent: 33.7, quoteType: "EQUITY" },
      { symbol: "BAD SYMBOL<", regularMarketChangePercent: 50 },
      { symbol: "SPY", regularMarketChangePercent: 40, quoteType: "ETF" },
    ] }] } };
    expect(parseScreener(j, "gainers").map((r) => r.symbol)).toEqual(["PTC", "XP"]);
    expect(parseScreener(j, "losers").map((r) => r.symbol)).toEqual(["XP", "PTC"]);
  });
});

describe("fiscal data", () => {
  it("reads total debt in trillions and the fiscal-YTD deficit in billions", () => {
    expect(parseDebtToPenny({ data: [{ record_date: "2026-10-01", tot_pub_debt_out_amt: "40260641972390.03" }] })[0].value).toBeCloseTo(40.26, 2);
    const ytd = parseMtsYtd({ data: [
      { record_date: "2026-08-31", classification_desc: "August", current_month_dfct_sur_amt: "166796952277.38" },
      { record_date: "2026-08-31", classification_desc: "Year-to-Date", current_month_dfct_sur_amt: "1965591017473.53", print_order_nbr: "27" },
      // previous fiscal year's total, listed on the same statement
      { record_date: "2026-08-31", classification_desc: "Year-to-Date", current_month_dfct_sur_amt: "1775369189818.35", print_order_nbr: "14" },
    ] });
    expect(ytd).toHaveLength(1);
    expect(Math.round(ytd[0].value)).toBe(1966);
  });
  it("builds an indicator from an unsorted series", () => {
    const m = seriesIndicator(
      { id: "X", name: "X", group: "Fiscal", unit: "$T", note: "", source: "s", sourceUrl: "u" },
      [{ date: "2026-10-02", value: 2 }, { date: "2026-10-01", value: 1.5 }],
    );
    expect(m).toMatchObject({ value: 2, previous: 1.5, change: 0.5, asOf: "2026-10-02" });
  });
});

import { parseCoinMarkets } from "@/lib/finance/crypto";

describe("crypto markets", () => {
  it("normalises CoinGecko rows and downsamples sparklines", () => {
    const rows = parseCoinMarkets([
      { id: "bitcoin", symbol: "btc", name: "Bitcoin", market_cap_rank: 1, current_price: 85789, market_cap: 1.7e12, total_volume: 3e10, price_change_percentage_24h_in_currency: -1.2, price_change_percentage_7d_in_currency: 2.9, sparkline_in_7d: { price: Array.from({ length: 168 }, (_, i) => i) } },
    ]);
    expect(rows[0]).toMatchObject({ rank: 1, symbol: "BTC", change7d: 2.9 });
    expect(rows[0].spark.length).toBeLessThanOrEqual(45);
    expect(rows[0].spark[rows[0].spark.length - 1]).toBe(167);
  });
});

import { parseSearch } from "@/lib/finance/search";

describe("instrument search", () => {
  it("keeps valid Yahoo symbols across exchanges and labels types", () => {
    const hits = parseSearch({ quotes: [
      { symbol: "7203.T", shortname: "TOYOTA MOTOR CORP", exchDisp: "Tokyo Stock Exchange", quoteType: "EQUITY", isYahooFinance: true },
      { symbol: "TM", longname: "Toyota Motor Corporation", exchDisp: "NYSE", quoteType: "EQUITY", sector: "Consumer Cyclical", isYahooFinance: true },
      { symbol: "bad symbol!", quoteType: "EQUITY" },
      { symbol: "AAPL250117C00150000", quoteType: "OPTION" },
      { symbol: "XYZ", quoteType: "EQUITY", isYahooFinance: false },
    ] });
    expect(hits.map((h) => h.symbol)).toEqual(["7203.T", "TM"]);
    expect(hits[1]).toMatchObject({ name: "Toyota Motor Corporation", type: "Stock", exchange: "NYSE", sector: "Consumer Cyclical" });
  });
});
