/**
 * 10-K analysis: XBRL deltas, filing-text section extraction (TOC skipped),
 * chunking and the map-reduce driver with a mock model (no network).
 */
import { describe, expect, it } from "vitest";
import { annualPair, computeFilingFacts, extractSections, factsForAI, htmlToText, instantAt, type CompanyFacts, type XbrlRow } from "@/lib/finance/filing-analysis";
import { formatFactChange, formatFactValue } from "@/lib/finance/filing-format";
import { chunkText, runFilingAnalysis, type FilingRunner } from "@/lib/ai/filing";
import type { FilingSections } from "@/lib/ai/types";

const ACC = "0000320193-25-000079";
const OLD = "0000320193-24-000123";

const dur = (start: string, end: string, val: number, accn = ACC): XbrlRow => ({ start, end, val, accn, form: "10-K", filed: accn === ACC ? "2025-10-31" : "2024-11-01" });
const inst = (end: string, val: number, accn = ACC): XbrlRow => ({ end, val, accn, form: "10-K", filed: accn === ACC ? "2025-10-31" : "2024-11-01" });
const FY25 = ["2024-09-29", "2025-09-27"] as const;
const FY24 = ["2023-10-01", "2024-09-28"] as const;
const FY23 = ["2022-09-25", "2023-09-30"] as const;
const usd = (rows: XbrlRow[]) => ({ units: { USD: rows } });

// Apple's FY2025 10-K figures (as reported), trimmed to what the computation uses.
const FACTS: CompanyFacts = {
  facts: {
    "us-gaap": {
      RevenueFromContractWithCustomerExcludingAssessedTax: usd([dur(...FY23, 383285e6), dur(...FY24, 391035e6), dur(...FY25, 416161e6), dur("2025-06-29", "2025-09-27", 102466e6)]),
      GrossProfit: usd([dur(...FY24, 180683e6), dur(...FY25, 195201e6)]),
      OperatingIncomeLoss: usd([dur(...FY24, 123216e6), dur(...FY25, 133050e6)]),
      NetIncomeLoss: usd([dur(...FY24, 93736e6), dur(...FY25, 112010e6), dur(...FY24, 93000e6, OLD)]),
      EarningsPerShareDiluted: { units: { "USD/shares": [dur(...FY24, 6.08), dur(...FY25, 7.46)] } },
      NetCashProvidedByUsedInOperatingActivities: usd([dur(...FY24, 118254e6), dur(...FY25, 111482e6)]),
      PaymentsToAcquirePropertyPlantAndEquipment: usd([dur(...FY24, 9447e6), dur(...FY25, 12715e6)]),
      ResearchAndDevelopmentExpense: usd([dur(...FY24, 31370e6), dur(...FY25, 34550e6)]),
      WeightedAverageNumberOfDilutedSharesOutstanding: { units: { shares: [dur(...FY24, 15408095e3), dur(...FY25, 15004697e3)] } },
      CashAndCashEquivalentsAtCarryingValue: usd([inst("2024-09-28", 29943e6), inst("2025-09-27", 35934e6)]),
      LongTermDebt: usd([inst("2024-09-28", 96662e6), inst("2025-09-27", 90678e6)]),
      CommercialPaper: usd([inst("2024-09-28", 9967e6), inst("2025-09-27", 7979e6)]),
      StockholdersEquity: usd([inst("2023-09-30", 62146e6), inst("2024-09-28", 56950e6), inst("2025-09-27", 73733e6)]),
    },
  },
};

describe("XBRL fiscal-year selection", () => {
  it("picks the filing's own current and prior fiscal years, ignoring quarters", () => {
    const rows = (FACTS.facts!["us-gaap"].RevenueFromContractWithCustomerExcludingAssessedTax.units!.USD);
    const { cur, prior } = annualPair(rows, ACC, "2025-09-27");
    expect(cur?.val).toBe(416161e6);
    expect(prior?.val).toBe(391035e6);
    expect(annualPair(rows, ACC, null).cur?.end).toBe("2025-09-27");
  });
  it("prefers the selected filing's comparatives over an older filing", () => {
    const { prior } = annualPair(FACTS.facts!["us-gaap"].NetIncomeLoss.units!.USD, ACC, "2025-09-27");
    expect(prior?.val).toBe(93736e6);
  });
  it("falls back to other filings when this accession has no rows", () => {
    const rows = [dur(...FY24, 1, OLD), dur(...FY25, 2, "0000320193-26-000001")];
    expect(annualPair(rows, ACC, "2025-09-27")).toMatchObject({ cur: { val: 2 }, prior: { val: 1 } });
    expect(instantAt([inst("2025-09-30", 5, OLD)], ACC, "2025-09-27")?.val).toBe(5);
    expect(instantAt([inst("2025-08-01", 5)], ACC, "2025-09-27")).toBeNull();
  });
});

describe("computed 10-K financials", () => {
  const f = computeFilingFacts(FACTS, ACC, "2025-09-27");
  const line = (k: string) => f.lines.find((l) => l.key === k)!;

  it("computes year-over-year changes, margins and derived figures", () => {
    expect(f.periodEnd).toBe("2025-09-27");
    expect(f.priorPeriodEnd).toBe("2024-09-28");
    expect(line("revenue").change).toBeCloseTo(6.43, 2);
    expect(line("netIncome").change).toBeCloseTo(19.5, 1);
    expect(line("grossMargin").current).toBeCloseTo(46.906, 2);
    expect(line("grossMargin").change).toBeCloseTo(46.906 - 46.206, 1); // percentage points
    expect(line("operatingMargin").current).toBeCloseTo(31.97, 2);
    expect(line("fcf").current).toBe(111482e6 - 12715e6);
    expect(line("fcf").prior).toBe(118254e6 - 9447e6);
    expect(line("rndPct").current).toBeCloseTo(8.30, 2);
    expect(line("debt").current).toBe(90678e6 + 7979e6);
    expect(line("debt").source).toBe("LongTermDebt + CommercialPaper");
    expect(line("debtToEquity").current).toBeCloseTo(98657 / 73733, 3);
    expect(line("equity").prior).toBe(56950e6);
    expect(line("dilutedShares").change).toBeCloseTo(-2.62, 2);
    expect(line("eps").current).toBe(7.46);
    expect(f.missing).toEqual([]);
  });

  it("lists figures that aren't reported instead of inventing them", () => {
    const g = computeFilingFacts({ facts: { "us-gaap": { NetIncomeLoss: usd([dur(...FY24, 10), dur(...FY25, 12)]) } } }, ACC, null);
    expect(g.lines.map((l) => l.key)).toEqual(["netIncome"]);
    expect(g.missing).toContain("Revenue");
    expect(g.missing).toContain("Free cash flow");
    expect(computeFilingFacts({}, ACC, "2025-09-27").lines).toEqual([]);
  });

  it("sums long-term debt parts when no total is tagged", () => {
    const g = computeFilingFacts(
      { facts: { "us-gaap": { NetIncomeLoss: usd([dur(...FY25, 1)]), LongTermDebtNoncurrent: usd([inst("2025-09-27", 80)]), LongTermDebtCurrent: usd([inst("2025-09-27", 20)]) } } },
      ACC,
      "2025-09-27",
    );
    expect(g.lines.find((l) => l.key === "debt")?.current).toBe(100);
  });

  it("formats figures for display and for the model", () => {
    expect(formatFactValue(416161e6, "USD")).toBe("$416.16B");
    expect(formatFactValue(-2.5e6, "USD")).toBe("−$2.5M");
    expect(formatFactValue(15004697e3, "shares")).toBe("15.00B shares");
    expect(formatFactChange({ change: 0.7, unit: "percent" })).toBe("+0.7 pp");
    expect(formatFactChange({ change: -2.62, unit: "shares" })).toBe("−2.6%");
    expect(factsForAI(f)[0]).toEqual({ label: "Revenue", current: "$416.16B", prior: "$391.04B", change: "+6.4%" });
  });
});

// A compact 10-K in the shape EDGAR serves: inline-XBRL header, a table of contents
// with item rows in table cells, the body, and cross-references mid-sentence.
const FILLER = (topic: string, n: number) => Array.from({ length: n }, (_, i) => `<p>${topic} paragraph ${i + 1} with enough words to look like real disclosure text about the company&#8217;s operations.</p>`).join("\n");
const HTML = `<html><head><title>aapl-20250927</title><style>.x{color:red}</style></head><body>
<div style="display:none"><ix:header><ix:hidden>Item 1A. hidden XBRL junk</ix:hidden></ix:header></div>
<table>
<tr><td>Item 1.</td><td>Business</td><td>1</td></tr>
<tr><td>Item 1A.</td><td>Risk Factors</td><td>5</td></tr>
<tr><td>Item 1B.</td><td>Unresolved Staff Comments</td><td>17</td></tr>
<tr><td>Item 7.</td><td>Management&#8217;s Discussion and Analysis</td><td>21</td></tr>
<tr><td>Item 7A.</td><td>Quantitative and Qualitative Disclosures About Market Risk</td><td>29</td></tr>
<tr><td>Item 8.</td><td>Financial Statements</td><td>30</td></tr>
</table>
<div><span style="font-weight:700">PART I</span></div>
<div><span style="font-weight:700">Item 1.&#160;&#160;&#160;&#160;Business</span></div>
${FILLER("Business", 6)}
<p>See Item 1A of this Form 10-K for risks.</p>
<div><span>ITEM 1A. RISK FACTORS</span></div>
${FILLER("Risk", 10)}
<div>Item 1B.&nbsp;Unresolved Staff Comments</div><p>None.</p>
<div>Item 1C. Cybersecurity</div>${FILLER("Cyber", 2)}
<div>Item 7. Management&rsquo;s Discussion and Analysis of Financial Condition and Results of Operations</div>
${FILLER("MDNA", 8)}
<div>Item 7A. Quantitative and Qualitative Disclosures About Market Risk</div>
${FILLER("Market", 3)}
<div>Item 8. Financial Statements and Supplementary Data</div>
<p>Balance sheet &amp; more.</p>
</body></html>`;

describe("10-K text extraction", () => {
  const text = htmlToText(HTML);

  it("strips HTML, inline-XBRL headers and entities", () => {
    expect(text).not.toMatch(/<|hidden XBRL|color:red|&#/);
    expect(text).toContain("Management’s Discussion");
    expect(text).toContain("Balance sheet & more.");
    expect(text).toMatch(/^Item 1\. Business$/m);
  });

  it("finds Items 1, 1A, 7 and 7A in the body, not the table of contents", () => {
    const s = extractSections(text);
    expect(Object.keys(s).sort()).toEqual(["business", "marketRisk", "mdna", "riskFactors"]);
    expect(s.business).toMatch(/^Business\s+Business paragraph 1/);
    expect(s.business).toContain("See Item 1A of this Form 10-K"); // mid-line cross-reference isn't a heading
    expect(s.business).not.toContain("Risk paragraph");
    expect(s.riskFactors).toMatch(/^RISK FACTORS/);
    expect(s.riskFactors).toContain("Risk paragraph 10");
    expect(s.riskFactors).not.toContain("Unresolved");
    expect(s.mdna).toContain("MDNA paragraph 8");
    expect(s.mdna).not.toContain("Market paragraph");
    expect(s.marketRisk).toContain("Market paragraph 3");
    expect(s.marketRisk).not.toContain("Balance sheet");
  });

  it("returns nothing for documents without item headings", () => {
    expect(extractSections("Just some text.\nNo items here.")).toEqual({});
  });
});

describe("chunking", () => {
  it("splits on paragraph boundaries within the limit and loses no text", () => {
    const paras = Array.from({ length: 30 }, (_, i) => `Paragraph ${i} ${"word ".repeat(20).trim()}.`);
    const text = paras.join("\n\n");
    const chunks = chunkText(text, 500);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(500);
    expect(chunks.every((c) => /^Paragraph \d+/.test(c))).toBe(true);
    expect(chunks.join("\n\n")).toBe(text);
  });
  it("falls back to words, then hard cuts", () => {
    expect(chunkText("aaaa bbbb cccc dddd", 10)).toEqual(["aaaa bbbb", "cccc dddd"]);
    expect(chunkText("x".repeat(25), 10)).toEqual(["x".repeat(10), "x".repeat(10), "x".repeat(5)]);
    expect(chunkText("short", 10)).toEqual(["short"]);
  });
});

describe("map-reduce filing analysis (mock model)", () => {
  const SECTIONS: FilingSections = {
    businessSummary: "Makes phones.",
    keyFinancialChanges: ["Revenue rose 6.4%."],
    topRisks: ["Supply chain concentration."],
    outlook: ["Gross margin guided flat."],
    notableChanges: ["Buybacks continued."],
    investorQuestions: ["How durable is services growth?"],
  };
  const mock = () => {
    const calls: Array<{ system: string; user: string }> = [];
    const runner: FilingRunner = {
      chunkChars: 1000,
      sectionBudget: { business: 300, riskFactors: 300, mdna: 300, marketRisk: 300 },
      maxSectionChars: 5000,
      complete: async (system, user) => {
        calls.push({ system, user });
        return `- note ${calls.length}\n- (no substantive content)`;
      },
      structured: async (system, user) => {
        calls.push({ system, user });
        return SECTIONS;
      },
    };
    return { runner, calls };
  };
  const input = { company: "Apple Inc.", form: "10-K", period: "fiscal year ended 2025-09-27", facts: [{ label: "Revenue", current: "$416.16B", prior: "$391.04B", change: "+6.4%" }] };

  it("summarises long sections in chunks, passes short ones through, reports progress", async () => {
    const { runner, calls } = mock();
    const steps: string[] = [];
    const out = await runFilingAnalysis(runner, { ...input, text: { business: "short business text", riskFactors: "Risk sentence. ".repeat(200) }, onProgress: (s) => steps.push(s) });
    expect(out).toEqual({ ...SECTIONS, outlook: [] }); // no MD&A text → no outlook from memory
    const maps = calls.filter((c) => c.system.includes("Risk Factors") && c.user.startsWith("Excerpt"));
    expect(maps.length).toBe(chunkText("Risk sentence. ".repeat(200), 1000).length);
    const final = calls.at(-1)!.user;
    expect(final).toContain("short business text");
    expect(final).toContain("- note 1");
    expect(final).not.toContain("no substantive content");
    expect(final).not.toContain("Risk sentence."); // raw text never reaches the final call
    expect(steps).toContain("Summarizing risk factors (1/4)…");
    expect(steps.at(-1)).toBe("Writing the analysis…");
  });

  it("financials-only: text-derived sections are blanked", async () => {
    const { runner, calls } = mock();
    const out = await runFilingAnalysis(runner, { ...input, text: null });
    expect(calls.length).toBe(1);
    expect(calls[0].user).toContain("text sections were not available");
    expect(out.businessSummary).toBe("");
    expect(out.topRisks).toEqual([]);
    expect(out.outlook).toEqual([]);
    expect(out.keyFinancialChanges).toEqual(SECTIONS.keyFinancialChanges);
  });
});
