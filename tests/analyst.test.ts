import { describe, expect, it, vi } from "vitest";
import type { WorldEvent } from "@/types/events";
import type { EventRepository } from "@/lib/db/types";
import type { Quote } from "@/lib/finance/types";
import { capJson, downsample } from "@/lib/analyst/cap";
import { TOOLS, describeCall, inputSchema, toolByName, toolCatalog, validateArgs, type ToolDeps } from "@/lib/analyst/tools";
import { extractJson, parseStep, stepJsonSchema } from "@/lib/analyst/protocol";
import { deskNotePlan, detectCountries, detectTickers, routeQuestion, MAX_TOOL_CALLS } from "@/lib/analyst/router";
import { citedIds, finalizeAnswer, formatCitation, makeCitation } from "@/lib/analyst/citations";
import { runAnalyst } from "@/lib/analyst/agent";
import type { JsonLLM, NativeLLM, NativeTurn } from "@/lib/analyst/llm";
import { ANALYST_DISCLAIMER, type AnalystStreamEvent } from "@/lib/analyst/types";

const NOW = Date.parse("2026-10-08T12:00:00Z");

function ev(over: Partial<WorldEvent> = {}): WorldEvent {
  return {
    id: "ev1",
    type: "CONFLICT",
    subtype: null,
    title: "Tanker attacked near the Strait of Hormuz",
    summary: "Reports of an attack on an oil tanker.",
    description: null,
    latitude: 26.5,
    longitude: 56.3,
    locationName: "Strait of Hormuz",
    country: "IR",
    countryName: "Iran",
    timestamp: "2026-10-08T09:00:00.000Z",
    updatedAt: "2026-10-08T10:00:00.000Z",
    importanceScore: 72,
    sourceCount: 3,
    status: "REPORTED",
    isSynthetic: false,
    confidenceScore: 0.7,
    sources: [{ sourceName: "reuters.com", sourceUrl: "https://example.com/a" }],
    metrics: {},
    ...over,
  } as unknown as WorldEvent;
}

const quote = (symbol: string, price: number | null = 100): Quote => ({
  symbol, name: `${symbol} name`, group: "watchlist", price, change: 1, changePct: 1.01, unit: "price", currency: "USD", asOf: "2026-10-08T11:55:00.000Z", spark: [1, 2], source: "Yahoo Finance (delayed)", delayed: true,
});

function mockDeps(over: Partial<ToolDeps> = {}): ToolDeps {
  const events = [
    ev(),
    ev({ id: "ev2", title: "OPEC+ meeting ends", importanceScore: 60, type: "POLITICS" }),
    ev({ id: "ev3", title: "Nvidia unveils a new data-center chip nvda", importanceScore: 40, type: "TECHNOLOGY" }),
    ev({ id: "ev4", title: "Brazil runoff set", summary: "via nvdaily", importanceScore: 50, type: "POLITICS" }),
  ];
  const repo = {
    query: vi.fn(async (q: { q?: string; limit?: number }) => {
      const hits = q.q ? events.filter((e) => q.q!.split(" ").every((t) => e.title.toLowerCase().includes(t))) : events;
      return { events: hits.slice(0, q.limit ?? 50), total: hits.length };
    }),
    scan: vi.fn(async () => events),
    get: vi.fn(async (id: string) => events.find((e) => e.id === id) ?? null),
    findNear: vi.fn(async () => events),
  } as unknown as EventRepository;
  const fail = () => Promise.reject(new Error("not mocked"));
  return {
    repo: async () => repo,
    now: () => NOW,
    getQuote: async (s) => quote(s),
    getHistory: async (symbol) => ({ symbol, name: "Nvidia", currency: "USD", exchange: null, instrumentType: null, points: Array.from({ length: 40 }, (_, i) => [NOW - (40 - i) * 86_400_000, 100 + i] as [number, number]), previousClose: null, dayHigh: null, dayLow: null, fiftyTwoWeekHigh: 150, fiftyTwoWeekLow: 80, volume: null, marketTime: "2026-10-08T11:00:00.000Z" }),
    changeSince: async (symbol) => ({ symbol, from: 80, to: 82, changePct: 2.5 }),
    getMarketSnapshot: fail,
    getScreener: fail,
    searchInstruments: fail,
    getMacroDashboard: fail,
    getEconomicCalendar: async () => [
      { id: "1", at: "2026-10-10T12:30:00.000Z", title: "Consumer Price Index", agency: "BLS", importance: "high", url: "https://bls.gov", detail: null },
      { id: "2", at: "2026-12-10T12:30:00.000Z", title: "Far away", agency: "BLS", importance: "low", url: "https://bls.gov", detail: null },
    ],
    getCot: fail,
    getPredictionMarkets: fail,
    getCryptoMarkets: fail,
    getRecentAuctions: fail,
    getYieldCurve: fail,
    getTermStructure: fail,
    companyProfile: async (t) => (t === "NVDA" ? ({ cik: "1045810", name: "NVIDIA CORP", tickers: ["NVDA"], exchanges: ["Nasdaq"], industry: "Semiconductors", hq: "Santa Clara, CA", fiscalYearEnd: "0125", filings: [{ form: "10-Q", filed: "2026-08-27", description: "Quarterly report", url: "https://sec.gov/x" }], annualReports: [], annualReportsUrl: "https://sec.gov", insiderFilings30d: 4, fundamentals: [{ label: "Revenue", value: 46e9, unit: "USD", period: "Q2 FY2027", priorValue: 30e9, filed: "2026-08-27" }], balanceSheet: [], revenueHistory: [], secUrl: "https://sec.gov/nvda" }) as never : null),
    filingAnalysisStatus: fail,
    startFilingAnalysis: fail,
    trackedManagers: [{ cik: "1067983", label: "Berkshire Hathaway", note: "Warren Buffett" } as never],
    managerHoldings: fail,
    holdersOf: fail,
    getEarningsReleases: fail,
    getRegistrations: fail,
    getTrends: fail,
    getEnergy: fail,
    getPlanetDashboard: fail,
    getChokepointMonitor: fail,
    getSecurityDashboard: fail,
    getCountryProfile: fail,
    marketExposure: (e) => (e.type === "CONFLICT" ? [{ symbol: "BZ=F", name: "Brent crude", rationale: "supply risk" }] : []),
    marketMovers: (events) => events.map((event) => ({ event, exposure: [{ symbol: "BZ=F", name: "Brent crude", rationale: "supply risk" }] })),
    findCountry: (s) => ({ iran: { code: "IR", name: "Iran" }, ir: { code: "IR", name: "Iran" }, japan: { code: "JP", name: "Japan" } } as Record<string, { code: string; name: string }>)[s.toLowerCase()] ?? null,
    ...over,
  };
}

const run = (name: string, args: Record<string, unknown>, deps = mockDeps()) => {
  const def = toolByName(name)!;
  const v = validateArgs(def, args);
  if (!v.ok) throw new Error(v.error);
  return def.run(v.args, deps);
};

describe("analyst: size capping", () => {
  it("shrinks arrays and strings until the JSON fits", () => {
    const big = { rows: Array.from({ length: 500 }, (_, i) => ({ i, text: "x".repeat(300), v: 1.23456789 })) };
    const s = capJson(big, 2000);
    expect(s.length).toBeLessThanOrEqual(2000);
    expect(s).toContain("more");
    expect(JSON.parse(s).rows[0].v).toBe(1.23);
  });
  it("drops empty values and keeps small payloads intact", () => {
    expect(JSON.parse(capJson({ a: 1, b: null, c: [], d: "ok" }, 1000))).toEqual({ a: 1, d: "ok" });
  });
  it("downsamples keeping both ends", () => {
    const d = downsample([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 4);
    expect(d).toHaveLength(4);
    expect(d[0]).toBe(1);
    expect(d.at(-1)).toBe(10);
  });
});

describe("analyst: tools", () => {
  it("every tool has a unique name, a description and a JSON schema", () => {
    expect(new Set(TOOLS.map((t) => t.name)).size).toBe(TOOLS.length);
    expect(TOOLS.length).toBeGreaterThanOrEqual(28);
    for (const t of TOOLS) {
      expect(t.description.length).toBeGreaterThan(10);
      expect(inputSchema(t).type).toBe("object");
    }
    expect(toolCatalog()).toContain("get_quote(symbols: string[])");
  });

  it("validates and normalises arguments", () => {
    const q = toolByName("get_quote")!;
    expect(validateArgs(q, { symbols: "nvda, AMD" })).toEqual({ ok: true, args: { symbols: ["nvda", "AMD"] } });
    expect(validateArgs(q, {})).toMatchObject({ ok: false });
    const h = toolByName("price_history")!;
    expect(validateArgs(h, { symbol: "NVDA", range: "1MO" })).toEqual({ ok: true, args: { symbol: "NVDA", range: "1mo" } });
    // a bad optional argument is dropped, not fatal
    expect(validateArgs(h, { symbol: "NVDA", range: "10y" })).toEqual({ ok: true, args: { symbol: "NVDA" } });
    expect(validateArgs(toolByName("search_events")!, { query: "oil", hours: "48", category: null })).toEqual({ ok: true, args: { query: "oil", hours: 48 } });
    expect(describeCall("get_quote", { symbols: ["NVDA", "AMD"] })).toBe("get_quote(NVDA, AMD)");
  });

  it("search_events returns compact events, citations and globe actions", async () => {
    const r = await run("search_events", { query: "tanker", country: "Iran" });
    const data = r.data as { count: number; events: Array<Record<string, unknown>> };
    expect(data.count).toBe(1);
    expect(data.events[0]).toMatchObject({ id: "ev1", country: "IR", importance: 72 });
    expect(data.events[0]).not.toHaveProperty("rawData");
    expect(r.actions?.[0]).toMatchObject({ kind: "event", id: "ev1", lat: 26.5 });
    expect(r.asOf).toBe("2026-10-08T10:00:00.000Z");
  });

  it("search_events falls back to any term when all-terms matching finds nothing", async () => {
    const r = await run("search_events", { query: "hormuz shipping disruption" });
    expect((r.data as { count: number }).count).toBe(1);
  });

  it("search_events matches tickers as words and by company name, not inside publisher names", async () => {
    const r = await run("search_events", { query: "NVDA", hours: 168 });
    const data = r.data as { matched: string; events: Array<{ id: string }> };
    expect(data.events.map((e) => e.id)).toEqual(["ev3"]);
    expect(data.matched).toBe('NVDA or "NVIDIA"');
  });

  it("get_quote returns quotes with source and as-of", async () => {
    const r = await run("get_quote", { symbols: ["nvda", "NVDA", "BZ=F"] });
    const data = r.data as { quotes: Array<{ symbol: string; price: number }> };
    expect(data.quotes.map((q) => q.symbol)).toEqual(["NVDA", "BZ=F"]);
    expect(r.source).toBe("Yahoo Finance (delayed)");
    expect(r.asOf).toBe("2026-10-08T11:55:00.000Z");
    expect(r.actions?.map((a) => a.kind)).toEqual(["instrument", "instrument"]);
  });

  it("price_history summarises the range", async () => {
    const r = await run("price_history", { symbol: "NVDA" });
    const d = r.data as { changeOverRangePct: number; closes: unknown[]; high: number; low: number };
    expect(d.closes.length).toBeLessThanOrEqual(16);
    expect(d.high).toBe(139);
    expect(d.low).toBe(100);
    expect(d.changeOverRangePct).toBeCloseTo(39, 0);
  });

  it("company_profile and exposure shapes", async () => {
    const p = await run("company_profile", { ticker: "nvda" });
    expect(p.data).toMatchObject({ name: "NVIDIA CORP", industry: "Semiconductors", fundamentals: [{ label: "Revenue", yearEarlier: 30e9 }] });
    expect((await run("company_profile", { ticker: "XXXX" })).data).toMatchObject({ found: false });

    const one = await run("exposure", { event_id: "ev1" });
    expect(one.data).toMatchObject({ exposure: [{ symbol: "BZ=F", changeSinceEventPct: 2.5 }] });
    const all = await run("exposure", {});
    expect((all.data as { events: unknown[] }).events).toHaveLength(4);
    const mine = await run("exposure", { symbols: ["BZ=F", "AAPL"] });
    expect((mine.data as { events: unknown[] }).events).toHaveLength(4);
    const none = await run("exposure", { symbols: ["AAPL"] }, mockDeps({ marketMovers: (evs) => evs.slice(0, 1).map((event) => ({ event, exposure: [{ symbol: "BZ=F", name: "Brent", rationale: "r" }] })) }));
    expect(none.data).toMatchObject({ events: [], otherEvents: [{ id: "ev1" }] });
    expect(none.summary).toBe("0 events exposed to 1 symbols");
  });

  it("economic_calendar keeps the window; fund_holdings resolves names", async () => {
    const c = await run("economic_calendar", { days: 7 });
    expect((c.data as { items: unknown[] }).items).toHaveLength(1);
    const unknown = await run("fund_holdings", { manager: "Nobody Capital" });
    expect(unknown.data).toMatchObject({ found: false, tracked: ["Berkshire Hathaway"] });
  });
});

describe("analyst: local JSON protocol", () => {
  it("extracts JSON from fenced or chatty output", () => {
    expect(extractJson('Sure!\n```json\n{"calls":[{"tool":"get_quote","args":{"symbols":["NVDA"]}}]}\n```')).toEqual({ calls: [{ tool: "get_quote", args: { symbols: ["NVDA"] } }] });
    expect(extractJson('{"a":"} not the end"}')).toEqual({ a: "} not the end" });
    expect(extractJson("no json here")).toBeNull();
  });

  it("parses calls, rejects unknown tools and bad args, dedupes and caps", () => {
    const s = parseStep(JSON.stringify({ calls: [
      { tool: "get_quote", args: { symbols: ["NVDA"] } },
      { tool: "get_quote", args: { symbols: ["NVDA"] } },
      { tool: "make_money", args: {} },
      { tool: "company_profile", args: { ticker: null } },
      { tool: "search_events", args: { query: "oil", category: null, country: null, hours: null, limit: null } },
      { tool: "yield_curve", args: {} },
      { tool: "crypto_markets", args: {} },
    ] }));
    expect(s.calls.map((c) => c.tool)).toEqual(["get_quote", "search_events", "yield_curve"]);
    expect(s.errors).toEqual(['unknown tool "make_money"', 'company_profile: missing required argument "ticker"']);
    expect(s.answer).toBe(false);
  });

  it("accepts shape variants and the answer signal", () => {
    expect(parseStep('{"tool":"yield_curve","args":{}}').calls).toHaveLength(1);
    expect(parseStep('{"action":"answer"}')).toEqual({ calls: [], errors: [], answer: true });
    expect(parseStep('{"calls":[]}').answer).toBe(true);
  });

  it("builds a grammar schema with one variant per tool", () => {
    const schema = stepJsonSchema();
    expect(schema.properties.calls.items.oneOf).toHaveLength(TOOLS.length);
    expect(schema.properties.calls.maxItems).toBe(3);
  });
});

describe("analyst: deterministic routing", () => {
  const find = mockDeps().findCountry;
  it("detects tickers but not acronyms", () => {
    expect(detectTickers("Give me a rundown on NVDA and $AMD vs the CPI print")).toEqual(["NVDA", "AMD"]);
    expect(detectTickers("what about nvidia?")).toEqual(["NVDA"]);
    expect(detectTickers("What's driving oil prices today?")).toEqual([]);
  });
  it("detects countries with the gazetteer", () => {
    expect(detectCountries("Is Japan's economy slowing?", find)).toEqual([{ code: "JP", name: "Japan" }]);
  });
  it("routes an oil question to quotes, events, curves and chokepoints", () => {
    const plan = routeQuestion("What's driving oil prices today?", { watchlist: [], findCountry: find });
    expect(plan[0]).toEqual({ tool: "get_quote", args: { symbols: ["BZ=F", "CL=F", "XLE"] } });
    expect(plan.map((c) => c.tool)).toEqual(expect.arrayContaining(["search_events", "futures_curves", "chokepoints"]));
    expect(plan.length).toBeLessThanOrEqual(MAX_TOOL_CALLS);
  });
  it("routes a single-stock question to the company tools", () => {
    const plan = routeQuestion("Give me a rundown on NVDA", { watchlist: [] });
    expect(plan.map((c) => c.tool).slice(0, 4)).toEqual(["get_quote", "company_profile", "price_history", "search_events"]);
  });
  it("routes watchlist questions to watchlist quotes and event exposure", () => {
    const plan = routeQuestion("Which world events could affect my watchlist?", { watchlist: ["AAPL", "GC=F"] });
    expect(plan[0]).toEqual({ tool: "get_quote", args: { symbols: ["AAPL", "GC=F"] } });
    expect(plan).toContainEqual({ tool: "exposure", args: { symbols: ["AAPL", "GC=F"] } });
  });
  it("always returns something and never more than the cap", () => {
    expect(routeQuestion("hello", { watchlist: [] }).length).toBeGreaterThan(0);
    expect(routeQuestion("oil gold wheat inflation jobs fed crypto war NVDA AAPL my watchlist", { watchlist: ["MSFT"] }).length).toBe(MAX_TOOL_CALLS);
    expect(deskNotePlan(["NVDA", "BTC-USD"]).length).toBeLessThanOrEqual(MAX_TOOL_CALLS);
  });
});

describe("analyst: citations", () => {
  const ok = makeCitation(1, "get_quote", "get_quote(NVDA)", { data: {}, summary: "1 quote", source: "Yahoo Finance (delayed)", asOf: "2026-10-08T11:55:12.000Z" }, "2026-10-08T12:00:00.000Z");
  const bad = makeCitation(2, "held_by", "held_by(NVDA)", null, "2026-10-08T12:00:01.000Z", "timed out");
  it("formats sources with timestamps", () => {
    expect(formatCitation(ok)).toBe("[S1] get_quote(NVDA) — Yahoo Finance (delayed); data as of 2026-10-08 11:55 UTC, fetched 2026-10-08 12:00 UTC");
    expect(formatCitation(bad)).toBe("[S2] held_by(NVDA) — failed (timed out)");
  });
  it("finalises answers: drops bogus markers and model source lists, appends ours and the disclaimer once", () => {
    const text = `NVDA is $100 [S1] and rising [S7].\n\nSources:\n- made up\n\n${ANALYST_DISCLAIMER}`;
    const out = finalizeAnswer(text, [ok, bad]);
    expect(out).toContain("NVDA is $100 [S1] and rising .");
    expect(out).not.toContain("made up");
    expect(out).toContain("[S2] held_by(NVDA) — failed");
    expect(out.split(ANALYST_DISCLAIMER)).toHaveLength(2);
    expect(out.endsWith(ANALYST_DISCLAIMER)).toBe(true);
    expect(citedIds("a [S2] b [S1, S2] c")).toEqual(["S2", "S1"]);
  });
});

describe("analyst: agent loop", () => {
  it("native: caps tool calls and forces an answer", async () => {
    const turns: Array<{ allowTools: boolean }> = [];
    let k = 0;
    const llm: NativeLLM = {
      kind: "native",
      provider: "fake",
      model: "fake-1",
      async turn({ allowTools }): Promise<NativeTurn> {
        turns.push({ allowTools });
        if (!allowTools) return { text: "Done [S1].", calls: [], stop: "end_turn", raw: [] };
        // greedy model: always asks for two more tools
        return { text: "", stop: "tool_use", raw: [], calls: [0, 1].map(() => ({ id: `t${++k}`, name: "get_quote", input: { symbols: [`S${k}`] } })) };
      },
    };
    const events: AnalystStreamEvent[] = [];
    const r = await runAnalyst({ messages: [{ role: "user", content: "anything" }], watchlist: [] }, { llm, deps: mockDeps(), emit: (e) => events.push(e), now: () => NOW });
    expect(r.toolCalls).toBe(MAX_TOOL_CALLS);
    expect(r.mode).toBe("native");
    expect(turns.at(-1)!.allowTools).toBe(false);
    expect(events.filter((e) => e.type === "step")).toHaveLength(MAX_TOOL_CALLS);
    expect(events[0]).toMatchObject({ type: "start", provider: "fake", model: "fake-1" });
    expect(events.at(-1)).toMatchObject({ type: "answer", toolCalls: MAX_TOOL_CALLS });
    expect(r.text).toContain("Sources:\n[S1] get_quote(S1)");
  });

  it("native: a failing tool becomes an error result, not a crash", async () => {
    let first = true;
    const llm: NativeLLM = {
      kind: "native", provider: "fake", model: "m",
      async turn() {
        if (first) {
          first = false;
          return { text: "", stop: "tool_use", raw: [], calls: [{ id: "a", name: "yield_curve", input: {} }, { id: "b", name: "nope", input: {} }] };
        }
        return { text: "Yield data is unavailable [S1].", calls: [], stop: "end_turn", raw: [] };
      },
    };
    const r = await runAnalyst({ messages: [{ role: "user", content: "curve?" }], watchlist: [] }, { llm, deps: mockDeps(), emit: () => {}, now: () => NOW });
    expect(r.citations.map((c) => c.ok)).toEqual([false, false]);
    expect(r.text).toContain("[S1] yield_curve() — failed (not mocked)");
  });

  it("only starts a 10-K analysis when the user asked for one", async () => {
    const start = vi.fn(async () => ({ status: "running", step: "x", steps: [], error: null, result: null }) as never);
    const deps = mockDeps({
      companyProfile: async () => ({ name: "NVIDIA CORP", annualReports: [{ form: "10-K", accession: "0001045810-26-000001", filed: "2026-02-25", period: "2026-01-25", url: "https://sec.gov/10k", indexUrl: "" }] }) as never,
      filingAnalysisStatus: async () => ({ status: "none", step: null, steps: [], error: null, result: null }),
      startFilingAnalysis: start,
    });
    const llm = (): NativeLLM => {
      let first = true;
      return {
        kind: "native", provider: "fake", model: "m",
        async turn() {
          if (!first) return { text: "ok", calls: [], stop: "end_turn", raw: [] };
          first = false;
          return { text: "", stop: "tool_use", raw: [], calls: [{ id: "a", name: "annual_report_analysis", input: { ticker: "NVDA", start: true } }] };
        },
      };
    };
    await runAnalyst({ messages: [{ role: "user", content: "Rundown on NVDA" }], watchlist: [] }, { llm: llm(), deps, emit: () => {}, now: () => NOW });
    expect(start).not.toHaveBeenCalled();
    await runAnalyst({ messages: [{ role: "user", content: "Analyze NVDA's latest 10-K" }], watchlist: [] }, { llm: llm(), deps, emit: () => {}, now: () => NOW });
    expect(start).toHaveBeenCalledOnce();
  });

  function fakeJson(plans: string[], answer = "Brent rose [S1]."): JsonLLM & { prompts: string[] } {
    const prompts: string[] = [];
    return {
      kind: "json", provider: "local", model: "tiny", prompts,
      session: async (_system, fn) =>
        fn({
          json: async (p) => (prompts.push(p), plans.shift() ?? '{"calls":[]}'),
          text: async (p, _n, onDelta) => (prompts.push(p), onDelta?.(answer), answer),
        }),
    };
  }

  it("agent (local JSON protocol): plans, runs tools, stops when the model is done", async () => {
    const llm = fakeJson(['{"calls":[{"tool":"get_quote","args":{"symbols":["BZ=F"]}},{"tool":"search_events","args":{"query":"tanker"}}]}', '{"calls":[]}']);
    const events: AnalystStreamEvent[] = [];
    const r = await runAnalyst({ messages: [{ role: "user", content: "oil?" }], watchlist: [], mode: "agent" }, { llm, deps: mockDeps(), emit: (e) => events.push(e), now: () => NOW });
    expect(r.toolCalls).toBe(2);
    expect(r.mode).toBe("agent");
    expect(llm.prompts.at(-1)).toContain("Now write the answer");
    expect(events.some((e) => e.type === "answer_delta")).toBe(true);
    expect(r.text.startsWith("Brent rose [S1].")).toBe(true);
  });

  it("agent: the step cap holds across planning rounds", async () => {
    const three = '{"calls":[{"tool":"yield_curve","args":{}},{"tool":"get_quote","args":{"symbols":["A"]}},{"tool":"get_quote","args":{"symbols":["B"]}}]}';
    const llm = fakeJson([three, three.replace(/"A"/, '"C"').replace(/"B"/, '"D"'), three]);
    const r = await runAnalyst({ messages: [{ role: "user", content: "x" }], watchlist: [], mode: "agent" }, { llm, deps: mockDeps(), emit: () => {}, now: () => NOW });
    expect(r.toolCalls).toBe(MAX_TOOL_CALLS);
    // the last results reach the model together with the writing request
    expect(llm.prompts.at(-1)).toMatch(/^Tool results:[\s\S]*Now write the answer/);
  });

  it("agent: falls back to routing when the model picks no tools first", async () => {
    const llm = fakeJson(['{"calls":[]}']);
    const r = await runAnalyst({ messages: [{ role: "user", content: "Give me a rundown on NVDA" }], watchlist: [], mode: "agent" }, { llm, deps: mockDeps(), emit: () => {}, now: () => NOW });
    expect(r.citations[0].call).toBe("get_quote(NVDA)");
  });

  it("routed: runs the planned tools and asks the model only to write", async () => {
    const llm = fakeJson([]);
    const r = await runAnalyst({ messages: [{ role: "user", content: "desk note" }], watchlist: ["NVDA"], plan: [{ tool: "get_quote", args: { symbols: ["NVDA"] } }, { tool: "economic_calendar", args: { days: 5 } }] }, { llm, deps: mockDeps(), emit: () => {}, now: () => NOW });
    expect(r.mode).toBe("routed");
    expect(r.citations.map((c) => c.tool)).toEqual(["get_quote", "economic_calendar"]);
    expect(llm.prompts).toHaveLength(1);
    expect(llm.prompts[0]).toContain("[S2] economic_calendar(days=5)");
  });
});
