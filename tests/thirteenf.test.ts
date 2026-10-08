import { describe, expect, it } from "vitest";
import {
  TRACKED_MANAGERS,
  aggregateHoldings,
  buildNameIndex,
  commonTickers,
  detectValueUnit,
  diffHoldings,
  matchTicker,
  mergePositions,
  normalizeIssuer,
  parseCoverPage,
  parseInfoTable,
  thirteenFPeriods,
  wordLike,
  type InfoTableEntry,
} from "@/lib/finance/thirteenf";

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<informationTable xmlns="http://www.sec.gov/edgar/document/thirteenf/informationtable">
  <infoTable>
    <nameOfIssuer>APPLE INC</nameOfIssuer>
    <titleOfClass>COM</titleOfClass>
    <cusip>037833100</cusip>
    <value>1,000,000</value>
    <shrsOrPrnAmt><sshPrnamt>5000</sshPrnamt><sshPrnamtType>SH</sshPrnamtType></shrsOrPrnAmt>
    <investmentDiscretion>SOLE</investmentDiscretion>
    <votingAuthority><Sole>5000</Sole><Shared>0</Shared><None>0</None></votingAuthority>
  </infoTable>
  <infoTable>
    <nameOfIssuer>APPLE INC</nameOfIssuer>
    <titleOfClass>COM</titleOfClass>
    <cusip>037833100</cusip>
    <value>400000</value>
    <shrsOrPrnAmt><sshPrnamt>2000</sshPrnamt><sshPrnamtType>SH</sshPrnamtType></shrsOrPrnAmt>
    <investmentDiscretion>DFND</investmentDiscretion>
    <otherManager>1,2</otherManager>
  </infoTable>
  <infoTable>
    <nameOfIssuer>APPLE INC</nameOfIssuer>
    <titleOfClass>CALL</titleOfClass>
    <cusip>037833100</cusip>
    <value>200000</value>
    <shrsOrPrnAmt><sshPrnamt>1000</sshPrnamt><sshPrnamtType>SH</sshPrnamtType></shrsOrPrnAmt>
    <putCall>Call</putCall>
    <investmentDiscretion>SOLE</investmentDiscretion>
  </infoTable>
  <infoTable>
    <nameOfIssuer>AT&amp;T INC</nameOfIssuer>
    <titleOfClass>COM</titleOfClass>
    <cusip>00206r102</cusip>
    <value>400000</value>
    <shrsOrPrnAmt><sshPrnamt>20000</sshPrnamt><sshPrnamtType>SH</sshPrnamtType></shrsOrPrnAmt>
    <investmentDiscretion>SOLE</investmentDiscretion>
  </infoTable>
  <infoTable><nameOfIssuer>BROKEN</nameOfIssuer><cusip>X</cusip><value>n/a</value></infoTable>
</informationTable>`;

const PREFIXED = `<ns1:informationTable xmlns:ns1="http://www.sec.gov/edgar/document/thirteenf/informationtable">
<ns1:infoTable><ns1:nameOfIssuer>TESLA INC</ns1:nameOfIssuer><ns1:titleOfClass>COM</ns1:titleOfClass><ns1:cusip>88160R101</ns1:cusip>
<ns1:value>2500</ns1:value><ns1:shrsOrPrnAmt><ns1:sshPrnamt>10</ns1:sshPrnamt><ns1:sshPrnamtType>SH</ns1:sshPrnamtType></ns1:shrsOrPrnAmt>
<ns1:putCall>PUT</ns1:putCall><ns1:investmentDiscretion>SOLE</ns1:investmentDiscretion></ns1:infoTable>
</ns1:informationTable>`;

describe("13F info-table parser", () => {
  it("parses entries, decodes entities, strips commas and skips malformed rows", () => {
    const rows = parseInfoTable(XML);
    expect(rows).toHaveLength(4);
    expect(rows[0]).toEqual({
      nameOfIssuer: "APPLE INC",
      titleOfClass: "COM",
      cusip: "037833100",
      value: 1_000_000,
      sshPrnamt: 5000,
      sshPrnamtType: "SH",
      putCall: null,
      investmentDiscretion: "SOLE",
    });
    expect(rows[2].putCall).toBe("Call");
    expect(rows[3].nameOfIssuer).toBe("AT&T INC");
    expect(rows[3].cusip).toBe("00206R102");
  });

  it("tolerates namespace prefixes and upper-case put/call", () => {
    const [r] = parseInfoTable(PREFIXED);
    expect(r.nameOfIssuer).toBe("TESLA INC");
    expect(r.putCall).toBe("Put");
    expect(r.value).toBe(2500);
  });

  it("reads the cover page (period, amendment type, totals)", () => {
    const c = parseCoverPage(`<edgarSubmission><formData><coverPage><reportCalendarOrQuarter>06-30-2026</reportCalendarOrQuarter>
      <isAmendment>true</isAmendment><amendmentInfo><amendmentType>RESTATEMENT</amendmentType></amendmentInfo>
      <reportType>13F HOLDINGS REPORT</reportType></coverPage><summaryPage><tableEntryTotal>89</tableEntryTotal>
      <tableValueTotal>299253556246</tableValueTotal></summaryPage></formData></edgarSubmission>`);
    expect(c).toMatchObject({ period: "2026-06-30", isAmendment: true, amendmentType: "RESTATEMENT", tableEntryTotal: 89, tableValueTotal: 299253556246 });
    expect(parseCoverPage("<amendmentType>NEW HOLDINGS</amendmentType>").amendmentType).toBe("NEW HOLDINGS");
  });
});

const entry = (o: Partial<InfoTableEntry>): InfoTableEntry => ({
  nameOfIssuer: "X",
  titleOfClass: "COM",
  cusip: "000000000",
  value: 0,
  sshPrnamt: 0,
  sshPrnamtType: "SH",
  putCall: null,
  investmentDiscretion: "SOLE",
  ...o,
});

describe("value units", () => {
  it("uses dollars for filings made on/after 2023-01-03 and thousands before", () => {
    expect(detectValueUnit("2023-02-14", "2022-12-31")).toEqual({ unit: "dollars", basis: "filing-date" });
    expect(detectValueUnit("2023-01-02", "2022-09-30")).toEqual({ unit: "thousands", basis: "filing-date" });
    expect(detectValueUnit("2022-11-14", "2022-09-30").unit).toBe("thousands");
  });

  it("falls back to the report period when the filing date is unknown", () => {
    expect(detectValueUnit(null, "2022-12-31")).toEqual({ unit: "dollars", basis: "report-period" });
    expect(detectValueUnit(null, "2022-09-30")).toEqual({ unit: "thousands", basis: "report-period" });
  });

  it("corrects filers that kept the old unit, using the implied share price", () => {
    // 1,000 shares of a $150 stock reported in thousands → 150 (value ÷ shares = 0.15)
    const thousandsRows = Array.from({ length: 6 }, (_, i) => entry({ cusip: `C${i}`, value: 150, sshPrnamt: 1000 + i }));
    expect(detectValueUnit("2024-05-15", "2024-03-31", thousandsRows)).toEqual({ unit: "thousands", basis: "implied-price" });
    const dollarRows = Array.from({ length: 6 }, (_, i) => entry({ cusip: `C${i}`, value: 150_000_000, sshPrnamt: 1000 + i }));
    expect(detectValueUnit("2021-05-15", "2021-03-31", dollarRows)).toEqual({ unit: "dollars", basis: "implied-price" });
    const normal = Array.from({ length: 6 }, (_, i) => entry({ cusip: `C${i}`, value: 150_000, sshPrnamt: 1000 + i }));
    expect(detectValueUnit("2024-05-15", "2024-03-31", normal).basis).toBe("filing-date");
  });
});

describe("aggregation", () => {
  it("sums rows per CUSIP, keeps options separate, computes weights", () => {
    const pos = aggregateHoldings(parseInfoTable(XML), "dollars");
    expect(pos.map((p) => p.key)).toEqual(["037833100", "00206R102", "037833100:CALL"]);
    const aapl = pos[0];
    expect(aapl.value).toBe(1_400_000);
    expect(aapl.shares).toBe(7000);
    expect(aapl.weight).toBeCloseTo(70, 6);
    expect(pos[2].putCall).toBe("Call");
    expect(pos.reduce((s, p) => s + p.weight, 0)).toBeCloseTo(100, 6);
  });

  it("multiplies thousands into dollars", () => {
    const [p] = aggregateHoldings([entry({ value: 1234, sshPrnamt: 10 })], "thousands");
    expect(p.value).toBe(1_234_000);
  });

  it("merges an original with a new-holdings amendment", () => {
    const a = aggregateHoldings([entry({ cusip: "A", value: 100, sshPrnamt: 1 })], "dollars");
    const b = aggregateHoldings([entry({ cusip: "B", value: 300, sshPrnamt: 3 })], "dollars");
    const m = mergePositions([a, b]);
    expect(m.map((p) => [p.cusip, p.weight])).toEqual([["B", 75], ["A", 25]]);
  });
});

describe("quarter-over-quarter diff", () => {
  const prior = aggregateHoldings(
    [
      entry({ cusip: "KEEP", nameOfIssuer: "KEEP CO", value: 100, sshPrnamt: 10 }),
      entry({ cusip: "ADD", nameOfIssuer: "ADD CO", value: 100, sshPrnamt: 10 }),
      entry({ cusip: "CUT", nameOfIssuer: "CUT CO", value: 100, sshPrnamt: 10 }),
      entry({ cusip: "GONE", nameOfIssuer: "GONE CO", value: 500, sshPrnamt: 50 }),
    ],
    "dollars",
  );
  const current = aggregateHoldings(
    [
      entry({ cusip: "KEEP", nameOfIssuer: "KEEP CO", value: 120, sshPrnamt: 10 }),
      entry({ cusip: "ADD", nameOfIssuer: "ADD CO", value: 150, sshPrnamt: 15 }),
      entry({ cusip: "CUT", nameOfIssuer: "CUT CO", value: 40, sshPrnamt: 4 }),
      entry({ cusip: "NEW", nameOfIssuer: "NEW CO", value: 90, sshPrnamt: 9 }),
    ],
    "dollars",
  );

  it("classifies by share count, not value", () => {
    const { holdings, soldOut } = diffHoldings(current, prior);
    const by = Object.fromEntries(holdings.map((h) => [h.cusip, h]));
    expect(by.KEEP).toMatchObject({ change: "unchanged", sharesChange: 0, sharesChangePct: 0, priorValue: 100 });
    expect(by.ADD).toMatchObject({ change: "added", sharesChange: 5, sharesChangePct: 50 });
    expect(by.CUT).toMatchObject({ change: "reduced", sharesChange: -6, sharesChangePct: -60 });
    expect(by.NEW).toMatchObject({ change: "new", sharesChange: 9, sharesChangePct: null, priorShares: null });
    expect(soldOut).toHaveLength(1);
    expect(soldOut[0]).toMatchObject({ cusip: "GONE", priorValue: 500, priorShares: 50 });
  });

  it("treats a call on the same CUSIP as a different position", () => {
    const withCall = aggregateHoldings([entry({ cusip: "KEEP", value: 1, sshPrnamt: 1, putCall: "Call" })], "dollars");
    const { holdings, soldOut } = diffHoldings(withCall, prior);
    expect(holdings[0].change).toBe("new");
    expect(soldOut.map((s) => s.cusip).sort()).toEqual(["ADD", "CUT", "GONE", "KEEP"]);
  });

  it("returns null changes without a prior filing", () => {
    const { holdings, soldOut } = diffHoldings(current, null);
    expect(holdings.every((h) => h.change === null && h.sharesChange === null)).toBe(true);
    expect(soldOut).toEqual([]);
  });
});

describe("filing selection", () => {
  it("groups 13F-HR and amendments by report period, newest first", () => {
    const periods = thirteenFPeriods({
      form: ["13F-HR/A", "4", "13F-HR", "13F-NT", "13F-HR"],
      accessionNumber: ["a3", "x", "a2", "n", "a1"],
      filingDate: ["2026-09-02", "2026-08-20", "2026-08-14", "2026-05-15", "2026-05-15"],
      reportDate: ["2026-06-30", "", "2026-06-30", "2026-03-31", "2026-03-31"],
    });
    expect(periods.map((p) => p.period)).toEqual(["2026-06-30", "2026-03-31"]);
    expect(periods[0].filings.map((f) => f.accession)).toEqual(["a2", "a3"]);
    expect(periods[1].filings.map((f) => f.form)).toEqual(["13F-HR"]);
  });

  it("tracks unique, numeric CIKs", () => {
    const ciks = TRACKED_MANAGERS.map((m) => m.cik);
    expect(new Set(ciks).size).toBe(ciks.length);
    expect(ciks.every((c) => /^\d+$/.test(c))).toBe(true);
    expect(ciks).toContain("1067983");
  });
});

describe("CUSIP → ticker by name", () => {
  const index = buildNameIndex([
    { cik_str: 320193, ticker: "AAPL", title: "Apple Inc." },
    { cik_str: 70858, ticker: "BAC", title: "BANK OF AMERICA CORP /DE/" },
    { cik_str: 70858, ticker: "BAC-PB", title: "BANK OF AMERICA CORP /DE/" },
    { cik_str: 70858, ticker: "BACRP", title: "BANK OF AMERICA CORP /DE/" },
    { cik_str: 797468, ticker: "OXY", title: "OCCIDENTAL PETROLEUM CORP /DE/" },
    { cik_str: 1067983, ticker: "BRK-B", title: "BERKSHIRE HATHAWAY INC" },
    { cik_str: 1067983, ticker: "BRK-A", title: "BERKSHIRE HATHAWAY INC" },
    { cik_str: 920760, ticker: "LEN", title: "LENNAR CORP /NEW/" },
    { cik_str: 920760, ticker: "LEN-B", title: "LENNAR CORP /NEW/" },
    { cik_str: 1652044, ticker: "GOOGL", title: "Alphabet Inc." },
    { cik_str: 1652044, ticker: "GOOG", title: "Alphabet Inc." },
    { cik_str: 1754301, ticker: "FOXA", title: "Fox Corp" },
    { cik_str: 1754301, ticker: "FOX", title: "Fox Corp" },
    { cik_str: 1467858, ticker: "GM", title: "General Motors Co" },
    { cik_str: 886986, ticker: "TECK", title: "TECK RESOURCES LTD" },
    { cik_str: 886986, ticker: "TCKRF", title: "TECK RESOURCES LTD" },
    { cik_str: 1100663, ticker: "IVV", title: "iShares Trust" },
    { cik_str: 1100663, ticker: "IWM", title: "iShares Trust" },
    { cik_str: 1100663, ticker: "EFA", title: "iShares Trust" },
    { cik_str: 1100663, ticker: "AGG", title: "iShares Trust" },
    { cik_str: 1, ticker: "AAA", title: "Acme Holdings Inc" },
    { cik_str: 2, ticker: "BBB", title: "ACME HOLDINGS CORP" },
    { cik_str: 3, ticker: "CEPO", title: "Cantor Equity Partners I, Inc." },
    { cik_str: 4, ticker: "JEF", title: "Jefferies Financial Group Inc." },
  ]);
  const t = (issuer: string, titleOfClass = "COM", extra: { shareType?: "SH" | "PRN"; cusip?: string } = {}) => matchTicker(index, { issuer, titleOfClass, ...extra })?.ticker ?? null;

  it("normalizes names", () => {
    expect(normalizeIssuer("BANK OF AMERICA CORP /DE/")).toBe("BANK AMER");
    expect(normalizeIssuer("BANK OF AMER CORP")).toBe("BANK AMER");
    expect(normalizeIssuer("Moody's Corp")).toBe("MOODYS");
    expect(normalizeIssuer("AT&T INC.")).toBe("AT T");
  });

  it("matches exact, abbreviated and truncated names", () => {
    expect(matchTicker(index, { issuer: "APPLE INC", titleOfClass: "COM" })).toEqual({ ticker: "AAPL", source: "name" });
    expect(t("BANK OF AMER CORP")).toBe("BAC");
    expect(t("OCCIDENTAL PETE CORP")).toBe("OXY");
    expect(t("GENERAL MTRS CO")).toBe("GM");
    expect(t("TECK RESOURCES LTD", "CL B")).toBe("TECK");
    expect(t("JEFFERIES FINANCIAL GROUP IN")).toBe("JEF");
  });

  it("resolves share classes only when the ticker carries the class", () => {
    expect(t("BERKSHIRE HATHAWAY INC DEL", "CL B NEW")).toBe("BRK-B");
    expect(t("BERKSHIRE HATHAWAY INC DEL", "CL A")).toBe("BRK-A");
    expect(t("LENNAR CORP", "CL B")).toBe("LEN-B");
    expect(t("LENNAR CORP", "CL A")).toBeNull();
    expect(t("FOX CORP", "CL A COM")).toBe("FOXA");
    expect(t("FOX CORP", "CL B COM")).toBeNull();
    expect(t("ALPHABET INC", "CAP STK CL A")).toBeNull();
    expect(matchTicker(index, { issuer: "ALPHABET INC", titleOfClass: "CAP STK CL C", cusip: "02079K107" })).toEqual({ ticker: "GOOG", source: "cusip" });
  });

  it("never guesses: ambiguous names, multi-series trusts, debt, options-free numerals", () => {
    expect(t("ACME HLDGS")).toBeNull();
    expect(t("ISHARES TR", "CORE S&P500 ETF")).toBeNull();
    expect(t("APPLE INC", "NOTE 1.5% 2030")).toBeNull();
    expect(t("APPLE INC", "COM", { shareType: "PRN" })).toBeNull();
    expect(t("CANTOR EQUITY PARTNERS II")).toBeNull();
    expect(t("UNKNOWN WIDGETS INC")).toBeNull();
  });

  it("filters preferreds, notes and OTC duplicates from a company's tickers", () => {
    expect(commonTickers(["BAC", "BML-PG", "BAC-PB", "BACRP"])).toEqual(["BAC"]);
    expect(commonTickers(["GOOGL", "GOOG", "GOOGN", "GOOGM"])).toEqual(["GOOGL", "GOOG"]);
    expect(commonTickers(["TECK", "TCKRF"])).toEqual(["TECK"]);
    expect(commonTickers(["LEN", "LEN-B"])).toEqual(["LEN", "LEN-B"]);
  });

  it("compares abbreviated words", () => {
    expect(wordLike("PETE", "PETROLEUM")).toBe(true);
    expect(wordLike("MTRS", "MOTORS")).toBe(true);
    expect(wordLike("MANUFAC", "MFG")).toBe(true);
    expect(wordLike("II", "I")).toBe(false);
    expect(wordLike("APPLE", "AMAZON")).toBe(false);
  });
});
