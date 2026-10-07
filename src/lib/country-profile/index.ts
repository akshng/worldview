/**
 * Country profile: key economic and civic stats for one country, from free, keyless
 * official sources (plus Wikidata as a labelled community fallback):
 *
 *  - World Bank Indicators API (api.worldbank.org/v2): population, GDP, GDP per capita,
 *    real growth, CPI inflation, unemployment (ILO modelled), current account. Annual.
 *  - IMF DataMapper (World Economic Outlook): real growth, inflation, unemployment,
 *    general government gross debt, current account, and GDP/population fallbacks.
 *    Annual; projection years (after last year) are ignored.
 *  - Eurostat dissemination API (JSON-stat 2.0), EU + EFTA only: HICP inflation,
 *    unemployment (monthly), government debt (quarterly), 10-year convergence yield.
 *  - OECD SDMX, Key Short-Term Economic Indicators: CPI inflation, unemployment,
 *    3-month interbank rate, long-term (10-year) government bond yield. Monthly.
 *  - FRED (fredgraph.csv): fallback for the two OECD interest-rate series when the
 *    OECD endpoint itself is unreachable.
 *  - Wikidata SPARQL: capital, currency, head of state / government, HDI, and a
 *    fallback for population/GDP when no official source has them (community data).
 *
 * For each stat the most recent period wins; ties go to the more specific source
 * (Eurostat > OECD > World Bank > IMF > FRED). Wikidata numbers are only used when no
 * official value exists. Each source is fetched in parallel and fails in isolation.
 * Profiles are cached per country for 24 hours (30 minutes when a source failed).
 */
import "server-only";
import { userAgent } from "@/lib/env";
import { getCountry } from "@/lib/geo/gazetteer";

// ─── Types ──────────────────────────────────────────────────────────────────

export type ProfileKey =
  | "population"
  | "gdpUsd"
  | "gdpPerCapita"
  | "realGrowth"
  | "inflation"
  | "unemployment"
  | "govDebt"
  | "currentAccount"
  | "shortRate"
  | "yield10y"
  | "hdi";

export type ProfileSource = "Eurostat" | "OECD" | "World Bank" | "IMF" | "FRED" | "Wikidata";

export interface ProfileStat {
  key: ProfileKey;
  label: string;
  value: number;
  /** "people" | "USD" | "%" | "% of GDP" | "% p.a." | "index" */
  unit: string;
  /** "2025", "2026-Q1" or "2026-08" */
  period: string;
  source: ProfileSource;
  /** Dataset / series name, shown on hover */
  series: string;
  sourceUrl: string;
  /** Wikidata (community-edited) rather than an official statistical source */
  community?: boolean;
}

export interface ProfileFacts {
  capital: string[];
  /** Current official currencies (preferred-rank statements), e.g. France: EUR and XPF */
  currencies: Array<{ code: string | null; name: string }>;
  headOfState: string[];
  headOfGovernment: string[];
  wikidataId: string | null;
}

export interface CountryProfile {
  code: string;
  iso3: string | null;
  name: string;
  stats: ProfileStat[];
  facts: ProfileFacts | null;
  sources: Array<{ source: ProfileSource; ok: boolean; error?: string }>;
  generatedAt: string;
}

export const STAT_META: Record<ProfileKey, { label: string; unit: string }> = {
  population: { label: "Population", unit: "people" },
  gdpUsd: { label: "GDP", unit: "USD" },
  gdpPerCapita: { label: "GDP per capita", unit: "USD" },
  realGrowth: { label: "Real GDP growth", unit: "%" },
  inflation: { label: "Inflation", unit: "%" },
  unemployment: { label: "Unemployment", unit: "%" },
  govDebt: { label: "Gov. debt", unit: "% of GDP" },
  currentAccount: { label: "Current account", unit: "% of GDP" },
  shortRate: { label: "3M interbank rate", unit: "% p.a." },
  yield10y: { label: "10Y gov. yield", unit: "% p.a." },
  hdi: { label: "HDI", unit: "index" },
};

export const PROFILE_ORDER: ProfileKey[] = [
  "population",
  "gdpUsd",
  "gdpPerCapita",
  "realGrowth",
  "inflation",
  "unemployment",
  "govDebt",
  "currentAccount",
  "shortRate",
  "yield10y",
  "hdi",
];

const SOURCE_RANK: Record<ProfileSource, number> = { Eurostat: 0, OECD: 1, "World Bank": 2, IMF: 3, FRED: 4, Wikidata: 9 };

function stat(key: ProfileKey, value: number, period: string, source: ProfileSource, series: string, sourceUrl: string, community = false): ProfileStat {
  const s: ProfileStat = { key, label: STAT_META[key].label, value, unit: STAT_META[key].unit, period, source, series, sourceUrl };
  if (community) s.community = true;
  return s;
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

// ─── Merge ──────────────────────────────────────────────────────────────────

/** Sortable key for a period: "2025" → "2025-12", "2026-Q1" → "2026-03", "2026-08" → "2026-08". */
export function periodKey(period: string): string {
  const q = /^(\d{4})-Q([1-4])$/.exec(period);
  if (q) return `${q[1]}-${String(Number(q[2]) * 3).padStart(2, "0")}`;
  if (/^\d{4}$/.test(period)) return `${period}-12`;
  return period.slice(0, 7);
}

/** One stat per key: latest period wins, ties go to the higher-ranked source; Wikidata only as a last resort. */
export function mergeStats(candidates: ProfileStat[]): ProfileStat[] {
  const best = new Map<ProfileKey, ProfileStat>();
  for (const c of candidates) {
    if (!Number.isFinite(c.value)) continue;
    const cur = best.get(c.key);
    if (!cur) {
      best.set(c.key, c);
      continue;
    }
    if (!!cur.community !== !!c.community) {
      if (cur.community) best.set(c.key, c);
      continue;
    }
    const a = periodKey(c.period);
    const b = periodKey(cur.period);
    if (a > b || (a === b && SOURCE_RANK[c.source] < SOURCE_RANK[cur.source])) best.set(c.key, c);
  }
  return PROFILE_ORDER.flatMap((k) => (best.has(k) ? [best.get(k)!] : []));
}

// ─── World Bank ─────────────────────────────────────────────────────────────

export const WB_INDICATORS: Record<string, ProfileKey> = {
  "SP.POP.TOTL": "population",
  "NY.GDP.MKTP.CD": "gdpUsd",
  "NY.GDP.PCAP.CD": "gdpPerCapita",
  "NY.GDP.MKTP.KD.ZG": "realGrowth",
  "FP.CPI.TOTL.ZG": "inflation",
  "SL.UEM.TOTL.ZS": "unemployment",
  "BN.CAB.XOKA.GD.ZS": "currentAccount",
};

type WbRow = { indicator?: { id?: string; value?: string }; date?: string; value?: number | null };

export function parseWorldBank(body: unknown): ProfileStat[] {
  if (!Array.isArray(body) || !Array.isArray(body[1])) return [];
  const latest = new Map<string, WbRow>();
  for (const row of body[1] as WbRow[]) {
    const id = row.indicator?.id;
    if (!id || !(id in WB_INDICATORS) || num(row.value) === null || !/^\d{4}$/.test(row.date ?? "")) continue;
    const prev = latest.get(id);
    if (!prev || row.date! > prev.date!) latest.set(id, row);
  }
  return [...latest].map(([id, row]) =>
    stat(WB_INDICATORS[id], num(row.value)!, row.date!, "World Bank", row.indicator?.value ?? id, `https://data.worldbank.org/indicator/${id}`),
  );
}

// ─── IMF DataMapper ─────────────────────────────────────────────────────────

export const IMF_INDICATORS: Record<string, { key: ProfileKey; scale?: number; name: string }> = {
  NGDP_RPCH: { key: "realGrowth", name: "Real GDP growth (WEO)" },
  PCPIPCH: { key: "inflation", name: "Inflation, average consumer prices (WEO)" },
  LUR: { key: "unemployment", name: "Unemployment rate (WEO)" },
  GGXWDG_NGDP: { key: "govDebt", name: "General government gross debt (WEO)" },
  BCA_NGDPD: { key: "currentAccount", name: "Current account balance (WEO)" },
  NGDPD: { key: "gdpUsd", scale: 1e9, name: "GDP, current prices (WEO)" },
  NGDPDPC: { key: "gdpPerCapita", name: "GDP per capita, current prices (WEO)" },
  LP: { key: "population", scale: 1e6, name: "Population (WEO)" },
};

/** One IMF indicator payload (all countries) → this country's latest non-projection value. */
export function parseImf(indicator: string, body: unknown, iso3: string, maxYear: number): ProfileStat | null {
  const def = IMF_INDICATORS[indicator];
  const series = (body as { values?: Record<string, Record<string, Record<string, number | null>>> })?.values?.[indicator]?.[iso3];
  if (!def || !series) return null;
  const years = Object.keys(series)
    .filter((y) => /^\d{4}$/.test(y) && Number(y) <= maxYear && num(series[y]) !== null)
    .sort();
  const y = years.at(-1);
  if (!y) return null;
  return stat(def.key, num(series[y])! * (def.scale ?? 1), y, "IMF", def.name, `https://www.imf.org/external/datamapper/${indicator}@WEO/${iso3}`);
}

// ─── Eurostat (JSON-stat 2.0) ───────────────────────────────────────────────

/** EU + EFTA members, as Eurostat geo codes (Greece is EL). */
export const EUROSTAT_GEO: Record<string, string> = Object.fromEntries(
  "AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE IS NO CH LI".split(" ").map((c) => [c, c === "GR" ? "EL" : c]),
);

export const EUROSTAT_QUERIES: Array<{ key: ProfileKey; dataset: string; params: string; name: string }> = [
  { key: "inflation", dataset: "prc_hicp_minr", params: "unit=RCH_A&coicop18=TOTAL", name: "HICP, annual rate of change" },
  { key: "unemployment", dataset: "une_rt_m", params: "s_adj=SA&age=TOTAL&unit=PC_ACT&sex=T", name: "Unemployment rate, seasonally adjusted" },
  { key: "govDebt", dataset: "gov_10q_ggdebt", params: "unit=PC_GDP&sector=S13&na_item=GD", name: "General government gross debt (quarterly)" },
  { key: "yield10y", dataset: "irt_lt_mcby_m", params: "int_rt=MCBY", name: "EMU convergence criterion 10-year bond yield" },
];

interface JsonStat {
  id?: string[];
  size?: number[];
  value?: Record<string, number | null> | Array<number | null>;
  dimension?: Record<string, { category?: { index?: Record<string, number> | string[] } }>;
}

/** Latest observation in a JSON-stat 2.0 dataset whose non-time dimensions are all filtered to one value. */
export function parseJsonStat(body: unknown): { period: string; value: number } | null {
  const ds = body as JsonStat;
  if (!ds?.id || !ds.size || !ds.dimension || !ds.value) return null;
  const t = ds.id.indexOf("time");
  if (t < 0) return null;
  const rawIndex = ds.dimension.time?.category?.index;
  const index: Record<string, number> = Array.isArray(rawIndex) ? Object.fromEntries(rawIndex.map((p, i) => [p, i])) : (rawIndex ?? {});
  // Row-major strides; every other dimension is taken at position 0.
  let stride = 1;
  for (let i = ds.size.length - 1; i > t; i--) stride *= ds.size[i];
  const values = ds.value;
  let best: { period: string; value: number } | null = null;
  for (const [period, pos] of Object.entries(index)) {
    const v = num(Array.isArray(values) ? values[pos * stride] : values[String(pos * stride)]);
    if (v === null) continue;
    if (!best || periodKey(period) > periodKey(best.period)) best = { period, value: v };
  }
  return best;
}

// ─── OECD SDMX (CSV) ────────────────────────────────────────────────────────

export const OECD_KEI_URL = (iso3: string) =>
  `https://sdmx.oecd.org/public/rest/data/OECD.SDD.STES,DSD_KEI@DF_KEI,4.0/${iso3}.M.CP+UNEMP+IRLT+IR3TIB.....?lastNObservations=1&format=csvfile`;

/** Minimal CSV line splitter (handles quoted fields). */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

export function parseOecdKei(csv: string, iso3: string): ProfileStat[] {
  const lines = csv.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const head = splitCsvLine(lines[0]);
  const col = (n: string) => head.indexOf(n);
  const [cArea, cMeasure, cUnit, cAdj, cTrans, cTime, cValue] = ["REF_AREA", "MEASURE", "UNIT_MEASURE", "ADJUSTMENT", "TRANSFORMATION", "TIME_PERIOD", "OBS_VALUE"].map(col);
  if ([cMeasure, cTime, cValue].some((c) => c < 0)) return [];
  const url = "https://data-explorer.oecd.org/vis?df[ds]=dsDisseminateFinalDMZ&df[id]=DSD_KEI%40DF_KEI&df[ag]=OECD.SDD.STES";
  const out: ProfileStat[] = [];
  for (const line of lines.slice(1)) {
    const r = splitCsvLine(line);
    if (cArea >= 0 && r[cArea] !== iso3) continue;
    const v = num(r[cValue]);
    if (v === null) continue;
    const m = r[cMeasure];
    const period = r[cTime];
    if (m === "CP" && r[cTrans] === "GY") out.push(stat("inflation", v, period, "OECD", "CPI, year-on-year (KEI)", url));
    else if (m === "UNEMP" && r[cUnit] === "PT_LF" && (cAdj < 0 || r[cAdj] === "Y")) out.push(stat("unemployment", v, period, "OECD", "Unemployment rate, s.a. (KEI)", url));
    else if (m === "IRLT") out.push(stat("yield10y", v, period, "OECD", "Long-term interest rate (KEI)", url));
    else if (m === "IR3TIB") out.push(stat("shortRate", v, period, "OECD", "3-month interbank rate (KEI)", url));
  }
  return mergeStats(out);
}

// ─── FRED (fallback for OECD rates) ─────────────────────────────────────────

export function parseFredLatest(csv: string): { period: string; value: number } | null {
  let best: { period: string; value: number } | null = null;
  for (const line of csv.trim().split(/\r?\n/).slice(1)) {
    const [date, raw] = line.split(",");
    const v = num(raw === "." ? null : raw);
    if (v === null || !/^\d{4}-\d{2}/.test(date ?? "")) continue;
    if (!best || date > best.period) best = { period: date, value: v };
  }
  return best && { period: best.period.slice(0, 7), value: best.value };
}

// ─── Wikidata SPARQL ────────────────────────────────────────────────────────

export function wikidataQuery(iso2: string): string {
  const code = iso2.replace(/[^A-Z]/g, "");
  // Many items now carry only a language-neutral "mul" label, so both en and mul are read.
  return `SELECT ?country ?prop ?value ?valueLabel ?mulLabel ?unitCode ?unit ?time ?rank WHERE {
  ?country wdt:P297 "${code}" .
  FILTER NOT EXISTS { ?country wdt:P576 ?dissolved }
  {
    VALUES (?prop ?p ?ps) { ("P36" p:P36 ps:P36) ("P38" p:P38 ps:P38) ("P35" p:P35 ps:P35) ("P6" p:P6 ps:P6) }
    ?country ?p ?st . ?st ?ps ?value ; wikibase:rank ?rank .
    FILTER(?rank != wikibase:DeprecatedRank)
    FILTER NOT EXISTS { ?st pq:P582 ?end }
    OPTIONAL { ?value wdt:P498 ?unitCode }
    OPTIONAL { ?value rdfs:label ?valueLabel FILTER(LANG(?valueLabel) = "en") }
    OPTIONAL { ?value rdfs:label ?mulLabel FILTER(LANG(?mulLabel) = "mul") }
  } UNION {
    VALUES (?prop ?p ?ps ?psv) { ("P1082" p:P1082 ps:P1082 psv:P1082) ("P2131" p:P2131 ps:P2131 psv:P2131) ("P2132" p:P2132 ps:P2132 psv:P2132) ("P1081" p:P1081 ps:P1081 psv:P1081) }
    ?country ?p ?st . ?st ?ps ?value ; wikibase:rank ?rank .
    FILTER(?rank != wikibase:DeprecatedRank)
    OPTIONAL { ?st ?psv ?node . ?node wikibase:quantityUnit ?unit }
    OPTIONAL { ?st pq:P585 ?time }
  }
}`;
}

type Binding = Record<string, { value: string } | undefined>;

const PREFERRED = "http://wikiba.se/ontology#PreferredRank";
const USD = "http://www.wikidata.org/entity/Q4917";

export function parseWikidata(body: unknown): { facts: ProfileFacts; stats: ProfileStat[] } | null {
  const rows = ((body as { results?: { bindings?: Binding[] } })?.results?.bindings ?? []).filter((b) => b.prop?.value && b.value?.value);
  if (!rows.length) return null;
  const wikidataId = rows[0].country?.value.split("/").pop() ?? null;
  const pageUrl = wikidataId ? `https://www.wikidata.org/wiki/${wikidataId}` : "https://www.wikidata.org/";
  const byProp = new Map<string, Binding[]>();
  for (const r of rows) {
    const p = r.prop!.value;
    if (!byProp.has(p)) byProp.set(p, []);
    byProp.get(p)!.push(r);
  }
  /** Preferred-rank statements when present, otherwise all non-deprecated ones. */
  const best = (p: string) => {
    const list = byProp.get(p) ?? [];
    const pref = list.filter((r) => r.rank?.value === PREFERRED);
    return pref.length ? pref : list;
  };
  const labelOf = (r: Binding) => {
    const l = r.valueLabel?.value ?? r.mulLabel?.value;
    return l && !/^Q\d+$/.test(l) ? l : null;
  };
  const labels = (p: string) => [...new Set(best(p).map(labelOf).filter((l): l is string => !!l))];

  const currencies = new Map<string, { code: string | null; name: string }>();
  for (const r of best("P38")) {
    const code = r.unitCode?.value ?? null;
    const name = labelOf(r) ?? code;
    if (name && !currencies.has(code ?? name)) currencies.set(code ?? name, { code, name });
  }
  const facts: ProfileFacts = {
    capital: labels("P36"),
    currencies: [...currencies.values()],
    headOfState: labels("P35"),
    headOfGovernment: labels("P6"),
    wikidataId,
  };

  const stats: ProfileStat[] = [];
  const quant: Array<[string, ProfileKey, boolean]> = [
    ["P1082", "population", false],
    ["P2131", "gdpUsd", true],
    ["P2132", "gdpPerCapita", true],
    ["P1081", "hdi", false],
  ];
  for (const [p, key, needsUsd] of quant) {
    const list = (byProp.get(p) ?? []).filter((r) => r.time?.value && num(r.value?.value) !== null && (!needsUsd || r.unit?.value === USD));
    list.sort((a, b) => (a.time!.value < b.time!.value ? 1 : a.time!.value > b.time!.value ? -1 : 0));
    const top = list[0];
    if (!top) continue;
    const year = top.time!.value.slice(0, 4);
    stats.push(stat(key, num(top.value!.value)!, year, "Wikidata", `Wikidata ${p}`, pageUrl, true));
  }
  return { facts, stats };
}

// ─── Fetching ───────────────────────────────────────────────────────────────

const TIMEOUT = 15_000;

async function fetchText(url: string, accept = "*/*", init: RequestInit = {}): Promise<{ status: number; text: string }> {
  const res = await fetch(url, {
    ...init,
    headers: { "User-Agent": `${userAgent()} country-profile`, Accept: accept, ...(init.headers as Record<string, string>) },
    signal: AbortSignal.timeout(TIMEOUT),
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok && res.status !== 404) throw new Error(`HTTP ${res.status}`);
  return { status: res.status, text };
}

async function fetchJson(url: string): Promise<unknown> {
  const { status, text } = await fetchText(url, "application/json");
  if (status === 404) return null;
  return JSON.parse(text);
}

async function fromWorldBank(iso3: string): Promise<ProfileStat[]> {
  const ids = Object.keys(WB_INDICATORS).join(";");
  return parseWorldBank(await fetchJson(`https://api.worldbank.org/v2/country/${iso3}/indicator/${ids}?source=2&format=json&mrnev=1&per_page=100`));
}

/** IMF DataMapper returns every country per indicator, so each payload is shared across countries for 24 h. */
const imfCache = new Map<string, { at: number; body: Promise<unknown> }>();
function imfIndicator(id: string): Promise<unknown> {
  const hit = imfCache.get(id);
  if (hit && Date.now() - hit.at < 86_400_000) return hit.body;
  const body = fetchJson(`https://www.imf.org/external/datamapper/api/v1/${id}`);
  imfCache.set(id, { at: Date.now(), body });
  body.catch(() => imfCache.delete(id));
  return body;
}

async function fromImf(iso3: string, now: Date): Promise<ProfileStat[]> {
  const maxYear = now.getUTCFullYear() - 1;
  const results = await Promise.allSettled(Object.keys(IMF_INDICATORS).map(async (id) => parseImf(id, await imfIndicator(id), iso3, maxYear)));
  const ok = results.flatMap((r) => (r.status === "fulfilled" && r.value ? [r.value] : []));
  if (!ok.length && results.every((r) => r.status === "rejected")) throw (results[0] as PromiseRejectedResult).reason;
  return ok;
}

async function fromEurostat(geo: string): Promise<ProfileStat[]> {
  const base = "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data";
  const results = await Promise.allSettled(
    EUROSTAT_QUERIES.map(async (q) => {
      const obs = parseJsonStat(await fetchJson(`${base}/${q.dataset}?geo=${geo}&${q.params}&lastTimePeriod=3`));
      return obs ? stat(q.key, obs.value, obs.period, "Eurostat", q.name, `https://ec.europa.eu/eurostat/databrowser/view/${q.dataset}/default/table`) : null;
    }),
  );
  if (results.every((r) => r.status === "rejected")) throw (results[0] as PromiseRejectedResult).reason;
  return results.flatMap((r) => (r.status === "fulfilled" && r.value ? [r.value] : []));
}

/**
 * OECD's SDMX API allows only a few dozen requests per hour per IP, so one request
 * fetches the latest observations for every covered country and is shared for 24 h.
 */
let oecdAll: { at: number; text: Promise<string> } | null = null;
async function fromOecd(iso3: string): Promise<ProfileStat[]> {
  if (!oecdAll || Date.now() - oecdAll.at > 86_400_000) {
    const text = fetchText(OECD_KEI_URL(""), "text/csv").then((r) => (r.status === 404 ? "" : r.text));
    oecdAll = { at: Date.now(), text };
    text.catch(() => {
      // Let the next request retry, but not before 15 minutes (rate limit).
      oecdAll = { at: Date.now() - 86_400_000 + 15 * 60_000, text };
    });
  }
  return parseOecdKei(await oecdAll.text, iso3);
}

async function fromFred(iso2: string): Promise<ProfileStat[]> {
  const since = `${new Date().getUTCFullYear() - 2}-01-01`;
  const series: Array<[string, ProfileKey, string]> = [
    [`IRLTLT01${iso2}M156N`, "yield10y", "Long-term government bond yield (OECD via FRED)"],
    [`IR3TIB01${iso2}M156N`, "shortRate", "3-month interbank rate (OECD via FRED)"],
  ];
  const out = await Promise.allSettled(
    series.map(async ([id, key, name]) => {
      const { status, text } = await fetchText(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}&cosd=${since}`, "text/csv");
      const obs = status === 404 ? null : parseFredLatest(text);
      return obs ? stat(key, obs.value, obs.period, "FRED", name, `https://fred.stlouisfed.org/series/${id}`) : null;
    }),
  );
  return out.flatMap((r) => (r.status === "fulfilled" && r.value ? [r.value] : []));
}

async function fromWikidata(iso2: string): Promise<ReturnType<typeof parseWikidata>> {
  const { text } = await fetchText("https://query.wikidata.org/sparql", "application/sparql-results+json", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ query: wikidataQuery(iso2) }).toString(),
  });
  return parseWikidata(JSON.parse(text));
}

export async function buildCountryProfile(code: string, now = new Date()): Promise<CountryProfile> {
  const country = getCountry(code);
  const iso2 = country?.code ?? (code.length === 2 ? code.toUpperCase() : null);
  const iso3 = country?.iso3 && /^[A-Z]{3}$/.test(country.iso3) ? country.iso3 : code.length === 3 ? code.toUpperCase() : null;
  const name = country?.name ?? code.toUpperCase();

  const jobs: Array<[ProfileSource, () => Promise<ProfileStat[] | ReturnType<typeof parseWikidata>>]> = [];
  if (iso3) jobs.push(["World Bank", () => fromWorldBank(iso3)], ["IMF", () => fromImf(iso3, now)]);
  if (iso2 && EUROSTAT_GEO[iso2]) jobs.push(["Eurostat", () => fromEurostat(EUROSTAT_GEO[iso2])]);
  if (iso3) jobs.push(["OECD", () => fromOecd(iso3)]);
  if (iso2 && /^[A-Z]{2}$/.test(iso2)) jobs.push(["Wikidata", () => fromWikidata(iso2)]);

  const settled = await Promise.allSettled(jobs.map(([, run]) => run()));
  const candidates: ProfileStat[] = [];
  let facts: ProfileFacts | null = null;
  const sources: CountryProfile["sources"] = [];
  settled.forEach((r, i) => {
    const source = jobs[i][0];
    if (r.status === "rejected") {
      sources.push({ source, ok: false, error: r.reason instanceof Error ? r.reason.message : String(r.reason) });
      return;
    }
    sources.push({ source, ok: true });
    if (Array.isArray(r.value)) candidates.push(...r.value);
    else if (r.value) {
      facts = r.value.facts;
      candidates.push(...r.value.stats);
    }
  });

  // FRED only stands in for OECD's rate series when the OECD endpoint itself failed.
  const oecd = sources.find((s) => s.source === "OECD");
  if (iso2 && oecd && !oecd.ok) {
    try {
      candidates.push(...(await fromFred(iso2)));
      sources.push({ source: "FRED", ok: true });
    } catch (e) {
      sources.push({ source: "FRED", ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }

  return { code: iso2 ?? code.toUpperCase(), iso3, name, stats: mergeStats(candidates), facts, sources, generatedAt: now.toISOString() };
}

// ─── Cache ──────────────────────────────────────────────────────────────────

const DAY = 86_400_000;
const cache = new Map<string, { at: number; ttl: number; value: Promise<CountryProfile> }>();

/** Cached profile: 24 h, or 30 min when any source failed. Concurrent requests share one fetch. */
export function getCountryProfile(code: string): Promise<CountryProfile> {
  const key = code.toUpperCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.value;
  const entry = { at: Date.now(), ttl: DAY, value: buildCountryProfile(key) };
  cache.set(key, entry);
  entry.value.then(
    (p) => {
      if (p.sources.some((s) => !s.ok)) entry.ttl = 30 * 60_000;
    },
    () => cache.delete(key),
  );
  return entry.value;
}
