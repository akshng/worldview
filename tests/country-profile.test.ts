import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EUROSTAT_GEO,
  buildCountryProfile,
  mergeStats,
  parseFredLatest,
  parseImf,
  parseJsonStat,
  parseOecdKei,
  parseWikidata,
  parseWorldBank,
  periodKey,
  splitCsvLine,
  wikidataQuery,
  type ProfileStat,
} from "@/lib/country-profile";

// ─── Fixtures (trimmed real responses) ──────────────────────────────────────

const WORLD_BANK = [
  { page: 1, pages: 1, per_page: 100, total: 5, lastupdated: "2026-07-13" },
  [
    { indicator: { id: "NY.GDP.MKTP.CD", value: "GDP (current US$)" }, country: { id: "DE", value: "Germany" }, countryiso3code: "DEU", date: "2025", value: 5050922925047.05 },
    { indicator: { id: "SP.POP.TOTL", value: "Population, total" }, countryiso3code: "DEU", date: "2025", value: 83491249 },
    { indicator: { id: "SP.POP.TOTL", value: "Population, total" }, countryiso3code: "DEU", date: "2024", value: 83400000 },
    { indicator: { id: "FP.CPI.TOTL.ZG", value: "Inflation, consumer prices (annual %)" }, countryiso3code: "DEU", date: "2025", value: null },
    { indicator: { id: "XX.UNKNOWN", value: "Not ours" }, countryiso3code: "DEU", date: "2025", value: 1 },
  ],
];

const IMF = {
  values: {
    GGXWDG_NGDP: {
      DEU: { "2023": 62.9, "2024": 63.9, "2025": 64.1, "2026": 65.3 },
      LIE: { "2025": 0.5 },
    },
  },
  api: { version: "1", "output-method": "json" },
};

/** Eurostat JSON-stat 2.0: une_rt_m?geo=FR&...&lastTimePeriod=3 */
const EUROSTAT = {
  version: "2.0",
  class: "dataset",
  label: "Unemployment by sex and age - monthly data",
  source: "ESTAT",
  updated: "2026-10-02T23:00:00+0200",
  value: { "0": 8.1, "1": 8.2 },
  id: ["freq", "s_adj", "age", "unit", "sex", "geo", "time"],
  size: [1, 1, 1, 1, 1, 1, 3],
  dimension: {
    freq: { label: "Time frequency", category: { index: { M: 0 } } },
    s_adj: { category: { index: { SA: 0 } } },
    age: { category: { index: { TOTAL: 0 } } },
    unit: { category: { index: { PC_ACT: 0 } } },
    sex: { category: { index: { T: 0 } } },
    geo: { category: { index: { FR: 0 } } },
    time: { label: "Time", category: { index: { "2026-06": 0, "2026-07": 1, "2026-08": 2 } } },
  },
};

const OECD_CSV = `STRUCTURE,STRUCTURE_ID,ACTION,REF_AREA,FREQ,MEASURE,UNIT_MEASURE,ACTIVITY,ADJUSTMENT,TRANSFORMATION,TIME_PERIOD,OBS_VALUE,OBS_STATUS,UNIT_MULT,DECIMALS,BASE_PER
DATAFLOW,OECD.SDD.STES:DSD_KEI@DF_KEI(4.0),I,USA,M,IR3TIB,PA,_Z,_Z,_Z,2026-09,3.94,A,0,1,
DATAFLOW,OECD.SDD.STES:DSD_KEI@DF_KEI(4.0),I,USA,M,IRLT,PA,_Z,_Z,_Z,2026-09,4.99,A,0,1,
DATAFLOW,OECD.SDD.STES:DSD_KEI@DF_KEI(4.0),I,USA,M,CP,IX,_Z,_Z,_Z,2026-08,170.11,A,0,1,2015
DATAFLOW,OECD.SDD.STES:DSD_KEI@DF_KEI(4.0),I,USA,M,CP,GR,_Z,_Z,GY,2026-08,3.39,A,0,1,
DATAFLOW,OECD.SDD.STES:DSD_KEI@DF_KEI(4.0),I,USA,M,CP,GR,_Z,_Z,G1,2026-08,0.31,A,0,1,
DATAFLOW,OECD.SDD.STES:DSD_KEI@DF_KEI(4.0),I,USA,M,UNEMP,PT_LF,_T,Y,_Z,2026-09,4.2,A,0,1,
DATAFLOW,OECD.SDD.STES:DSD_KEI@DF_KEI(4.0),I,IND,M,IRLT,PA,_Z,_Z,_Z,2026-09,7.06,A,0,1,
DATAFLOW,OECD.SDD.STES:DSD_KEI@DF_KEI(4.0),I,USA,M,IRLT,PA,_Z,_Z,_Z,2026-08,,A,0,1,`;

const uri = (q: string) => ({ type: "uri", value: `http://www.wikidata.org/entity/${q}` });
const lit = (v: string) => ({ type: "literal", value: v });
const PREF = { type: "uri", value: "http://wikiba.se/ontology#PreferredRank" };
const NORMAL = { type: "uri", value: "http://wikiba.se/ontology#NormalRank" };
const C = uri("Q142");

/** Wikidata SPARQL JSON results for France (trimmed). */
const WIKIDATA = {
  head: { vars: ["country", "prop", "value", "valueLabel", "mulLabel", "unitCode", "unit", "time", "rank"] },
  results: {
    bindings: [
      { country: C, prop: lit("P36"), value: uri("Q90"), valueLabel: lit("Paris"), rank: NORMAL },
      { country: C, prop: lit("P36"), value: uri("Q90"), valueLabel: lit("Paris"), rank: NORMAL },
      { country: C, prop: lit("P38"), value: uri("Q4916"), mulLabel: lit("euro"), unitCode: lit("EUR"), rank: PREF },
      { country: C, prop: lit("P38"), value: uri("Q214393"), valueLabel: lit("CFP Franc"), unitCode: lit("XPF"), rank: PREF },
      { country: C, prop: lit("P38"), value: uri("Q184172"), valueLabel: lit("French franc"), unitCode: lit("FRF"), rank: NORMAL },
      { country: C, prop: lit("P35"), value: uri("Q3052772"), mulLabel: lit("Emmanuel Macron"), rank: PREF },
      { country: C, prop: lit("P6"), value: uri("Q999"), valueLabel: lit("Sébastien Lecornu"), rank: NORMAL },
      { country: C, prop: lit("P1082"), value: lit("68373433"), time: lit("2023-01-01T00:00:00Z"), rank: NORMAL },
      { country: C, prop: lit("P1082"), value: lit("66000000"), time: lit("2015-01-01T00:00:00Z"), rank: NORMAL },
      { country: C, prop: lit("P1082"), value: lit("1"), rank: NORMAL },
      { country: C, prop: lit("P2131"), value: lit("3051831611384"), unit: uri("Q4917"), time: lit("2023-01-01T00:00:00Z"), rank: PREF },
      { country: C, prop: lit("P2131"), value: lit("2900000000000"), unit: uri("Q4916"), time: lit("2024-01-01T00:00:00Z"), rank: NORMAL },
      { country: C, prop: lit("P1081"), value: lit("0.903"), time: lit("2021-01-01T00:00:00Z"), rank: NORMAL },
      { country: C, prop: lit("P1081"), value: lit("0.901"), time: lit("2019-01-01T00:00:00Z"), rank: NORMAL },
    ],
  },
};

const s = (over: Partial<ProfileStat>): ProfileStat => ({
  key: "inflation",
  label: "Inflation",
  value: 1,
  unit: "%",
  period: "2025",
  source: "World Bank",
  series: "x",
  sourceUrl: "https://example.org",
  ...over,
});

// ─── Parsers ────────────────────────────────────────────────────────────────

describe("country profile parsers", () => {
  it("World Bank: latest non-null value per known indicator", () => {
    const out = parseWorldBank(WORLD_BANK);
    expect(out.map((o) => [o.key, o.value, o.period])).toEqual([
      ["gdpUsd", 5050922925047.05, "2025"],
      ["population", 83491249, "2025"],
    ]);
    expect(out[0]).toMatchObject({ source: "World Bank", unit: "USD", sourceUrl: "https://data.worldbank.org/indicator/NY.GDP.MKTP.CD" });
    expect(parseWorldBank([{ message: [{ key: "Invalid value" }] }])).toEqual([]);
  });

  it("IMF: skips projection years and keeps real zeros out of 'missing'", () => {
    expect(parseImf("GGXWDG_NGDP", IMF, "DEU", 2025)).toMatchObject({ key: "govDebt", value: 64.1, period: "2025", unit: "% of GDP", source: "IMF" });
    expect(parseImf("GGXWDG_NGDP", IMF, "DEU", 2024)?.value).toBe(63.9);
    expect(parseImf("GGXWDG_NGDP", IMF, "FRA", 2025)).toBeNull();
    expect(parseImf("NGDP_RPCH", IMF, "DEU", 2025)).toBeNull();
  });

  it("IMF: scales billions and millions", () => {
    const body = { values: { NGDPD: { USA: { "2025": 30507.2 } }, LP: { USA: { "2025": 341.8 } } } };
    expect(parseImf("NGDPD", body, "USA", 2025)?.value).toBeCloseTo(30507.2e9);
    expect(parseImf("LP", body, "USA", 2025)?.value).toBeCloseTo(341.8e6);
  });

  it("Eurostat JSON-stat: latest observation, sparse values", () => {
    expect(parseJsonStat(EUROSTAT)).toEqual({ period: "2026-07", value: 8.2 });
    expect(parseJsonStat({ ...EUROSTAT, value: [7.9, null, 8.3] })).toEqual({ period: "2026-08", value: 8.3 });
    expect(parseJsonStat({ ...EUROSTAT, value: {} })).toBeNull();
    expect(parseJsonStat({ error: [{ status: 400 }] })).toBeNull();
  });

  it("Eurostat JSON-stat: quarterly periods compare correctly", () => {
    const q = { ...EUROSTAT, value: { "0": 63.9, "1": 64.4 }, size: [1, 1, 1, 1, 1, 1, 2], dimension: { ...EUROSTAT.dimension, time: { category: { index: { "2025-Q4": 0, "2026-Q1": 1 } } } } };
    expect(parseJsonStat(q)).toEqual({ period: "2026-Q1", value: 64.4 });
  });

  it("Eurostat geo codes cover EU + EFTA and map Greece to EL", () => {
    expect(EUROSTAT_GEO.GR).toBe("EL");
    expect(EUROSTAT_GEO.CH).toBe("CH");
    expect(EUROSTAT_GEO.US).toBeUndefined();
    expect(Object.keys(EUROSTAT_GEO)).toHaveLength(31);
  });

  it("OECD KEI CSV: picks yoy CPI, s.a. unemployment and both rates for one country", () => {
    const out = parseOecdKei(OECD_CSV, "USA");
    expect(out.map((o) => [o.key, o.value, o.period])).toEqual([
      ["inflation", 3.39, "2026-08"],
      ["unemployment", 4.2, "2026-09"],
      ["shortRate", 3.94, "2026-09"],
      ["yield10y", 4.99, "2026-09"],
    ]);
    expect(parseOecdKei(OECD_CSV, "IND")).toHaveLength(1);
    expect(parseOecdKei("", "USA")).toEqual([]);
  });

  it("CSV splitter handles quoted commas", () => {
    expect(splitCsvLine('a,"b, c",,"d ""e"""')).toEqual(["a", "b, c", "", 'd "e"']);
  });

  it("FRED CSV: latest numeric observation as a month", () => {
    expect(parseFredLatest("observation_date,IRLTLT01DEM156N\n2026-07-01,3.1\n2026-08-01,3.19\n2026-09-01,.\n")).toEqual({ period: "2026-08", value: 3.19 });
    expect(parseFredLatest("observation_date,X\n")).toBeNull();
  });

  it("Wikidata SPARQL: facts from preferred statements, mul labels, USD-only GDP", () => {
    const wd = parseWikidata(WIKIDATA)!;
    expect(wd.facts).toEqual({
      capital: ["Paris"],
      currencies: [
        { code: "EUR", name: "euro" },
        { code: "XPF", name: "CFP Franc" },
      ],
      headOfState: ["Emmanuel Macron"],
      headOfGovernment: ["Sébastien Lecornu"],
      wikidataId: "Q142",
    });
    expect(wd.stats.map((x) => [x.key, x.value, x.period, x.community])).toEqual([
      ["population", 68373433, "2023", true],
      ["gdpUsd", 3051831611384, "2023", true],
      ["hdi", 0.903, "2021", true],
    ]);
    expect(wd.stats[0].sourceUrl).toBe("https://www.wikidata.org/wiki/Q142");
    expect(parseWikidata({ results: { bindings: [] } })).toBeNull();
  });

  it("Wikidata query only embeds a sanitised ISO code", () => {
    expect(wikidataQuery('F"R')).toContain('wdt:P297 "FR"');
  });
});

// ─── Merge ──────────────────────────────────────────────────────────────────

describe("mergeStats", () => {
  it("normalises periods", () => {
    expect(periodKey("2025")).toBe("2025-12");
    expect(periodKey("2026-Q1")).toBe("2026-03");
    expect(periodKey("2026-08")).toBe("2026-08");
  });

  it("latest period wins, ties go to the more specific source", () => {
    const out = mergeStats([
      s({ value: 2.5, period: "2025", source: "World Bank" }),
      s({ value: 3.3, period: "2026-09", source: "Eurostat" }),
      s({ value: 3.4, period: "2026-09", source: "OECD" }),
      s({ key: "realGrowth", value: 0.2, period: "2025", source: "IMF" }),
      s({ key: "realGrowth", value: 0.24, period: "2025", source: "World Bank" }),
    ]);
    expect(out.map((o) => [o.key, o.value, o.source])).toEqual([
      ["realGrowth", 0.24, "World Bank"],
      ["inflation", 3.3, "Eurostat"],
    ]);
  });

  it("community values only fill gaps, even when newer", () => {
    const out = mergeStats([
      s({ key: "population", value: 70e6, period: "2026", source: "Wikidata", community: true }),
      s({ key: "population", value: 68e6, period: "2025", source: "World Bank" }),
      s({ key: "hdi", value: 0.9, period: "2021", source: "Wikidata", community: true }),
    ]);
    expect(out.map((o) => [o.key, o.value])).toEqual([
      ["population", 68e6],
      ["hdi", 0.9],
    ]);
  });

  it("omits non-finite values instead of showing zero", () => {
    expect(mergeStats([s({ value: NaN })])).toEqual([]);
  });
});

// ─── Orchestration ──────────────────────────────────────────────────────────

describe("buildCountryProfile", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("isolates failing sources and merges the rest", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        const ok = (body: string) => new Response(body, { status: 200 });
        if (url.includes("api.worldbank.org")) return ok(JSON.stringify(WORLD_BANK));
        if (url.includes("imf.org")) return new Response("Access Denied", { status: 403 });
        if (url.includes("eurostat") && url.includes("une_rt_m")) return ok(JSON.stringify(EUROSTAT));
        if (url.includes("eurostat")) return new Response("{}", { status: 404 });
        if (url.includes("sdmx.oecd.org")) return new Response("busy", { status: 429 });
        if (url.includes("fred.stlouisfed.org")) return ok("observation_date,X\n2026-08-01,3.19\n");
        if (url.includes("query.wikidata.org")) return ok(JSON.stringify(WIKIDATA));
        throw new Error(`unexpected ${url}`);
      }),
    );
    const p = await buildCountryProfile("FR", new Date("2026-10-06T00:00:00Z"));
    expect(p).toMatchObject({ code: "FR", iso3: "FRA", name: "France" });
    expect(p.sources.find((x) => x.source === "IMF")).toMatchObject({ ok: false });
    expect(p.sources.find((x) => x.source === "OECD")).toMatchObject({ ok: false, error: "HTTP 429" });
    expect(p.sources.find((x) => x.source === "FRED")).toMatchObject({ ok: true });
    const byKey = Object.fromEntries(p.stats.map((x) => [x.key, x]));
    expect(byKey.population).toMatchObject({ value: 83491249, source: "World Bank" });
    expect(byKey.unemployment).toMatchObject({ value: 8.2, period: "2026-07", source: "Eurostat" });
    expect(byKey.yield10y).toMatchObject({ value: 3.19, source: "FRED" });
    expect(byKey.hdi).toMatchObject({ community: true });
    expect(byKey.inflation).toBeUndefined();
    expect(p.facts?.headOfState).toEqual(["Emmanuel Macron"]);
  });
});
