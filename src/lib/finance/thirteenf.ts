/**
 * 13F institutional holdings — pure helpers and types (safe to import from tests
 * and, as types, from client components). Fetching lives in thirteenf-service.ts.
 *
 *  - parseInfoTable: the information-table XML of a 13F-HR (namespace prefixes tolerated)
 *  - detectValueUnit: dollars (filed on/after 2023-01-03) vs thousands (earlier filings)
 *  - aggregateHoldings: one row per CUSIP + put/call, with portfolio weight
 *  - diffHoldings: quarter-over-quarter change vs the prior 13F (new / added / reduced / sold out)
 *  - buildNameIndex / matchTicker: best-effort CUSIP → ticker via SEC company names
 */

// ── Curated managers ────────────────────────────────────────────────────────

export interface TrackedManager {
  /** SEC CIK, unpadded */
  cik: string;
  label: string;
  /** Who runs it / what it is */
  note: string;
}

/** CIKs verified against data.sec.gov/submissions (each files 13F-HR under this CIK). */
export const TRACKED_MANAGERS: TrackedManager[] = [
  { cik: "1067983", label: "Berkshire Hathaway", note: "Warren Buffett / Greg Abel" },
  { cik: "1350694", label: "Bridgewater Associates", note: "Ray Dalio's firm; macro" },
  { cik: "1336528", label: "Pershing Square", note: "Bill Ackman; concentrated activist" },
  { cik: "1649339", label: "Scion Asset Management", note: "Michael Burry" },
  { cik: "1037389", label: "Renaissance Technologies", note: "Quantitative" },
  { cik: "1423053", label: "Citadel Advisors", note: "Ken Griffin; multi-strategy" },
  { cik: "1656456", label: "Appaloosa", note: "David Tepper" },
  { cik: "1536411", label: "Duquesne Family Office", note: "Stanley Druckenmiller" },
  { cik: "1167483", label: "Tiger Global", note: "Chase Coleman; growth / tech" },
  { cik: "1697748", label: "ARK Investment Management", note: "Cathie Wood; innovation ETFs" },
  { cik: "1029160", label: "Soros Fund Management", note: "George Soros family office" },
  { cik: "1040273", label: "Third Point", note: "Dan Loeb; activist" },
  { cik: "2012383", label: "BlackRock", note: "Largest asset manager; mostly index funds" },
  { cik: "1179392", label: "Two Sigma Investments", note: "Quantitative" },
  { cik: "1273087", label: "Millennium Management", note: "Izzy Englander; multi-strategy" },
  { cik: "1009207", label: "D. E. Shaw & Co.", note: "Quantitative / multi-strategy" },
  { cik: "1791786", label: "Elliott Investment Management", note: "Paul Singer; activist" },
  { cik: "1061768", label: "Baupost Group", note: "Seth Klarman; value" },
  { cik: "1061165", label: "Lone Pine Capital", note: "Stephen Mandel's firm; long/short equity" },
  { cik: "1135730", label: "Coatue Management", note: "Philippe Laffont; tech" },
  { cik: "1103804", label: "Viking Global Investors", note: "Andreas Halvorsen; long/short equity" },
  { cik: "921669", label: "Carl Icahn", note: "Icahn Enterprises; activist" },
  { cik: "1166559", label: "Gates Foundation Trust", note: "Bill & Melinda Gates Foundation endowment" },
  { cik: "1541617", label: "Altimeter Capital", note: "Brad Gerstner; tech" },
  { cik: "1345471", label: "Trian Fund Management", note: "Nelson Peltz; activist" },
  { cik: "1418814", label: "ValueAct", note: "Activist value" },
  { cik: "1709323", label: "Himalaya Capital", note: "Li Lu; value" },
];

export const THIRTEENF_CAVEATS = [
  "13F reports are filed up to 45 days after quarter end — positions may have changed since.",
  "Only long positions in 13(f) securities (US-listed stocks, some ETFs, convertibles and listed options) are reported; short positions, cash, bonds and non-US holdings are not shown.",
  "Option rows show the value of the underlying shares, not the premium. Confidential positions may be omitted.",
  "Information only — not investment advice.",
];

// ── Info table parsing ──────────────────────────────────────────────────────

export type PutCall = "Put" | "Call";

export interface InfoTableEntry {
  nameOfIssuer: string;
  titleOfClass: string;
  cusip: string;
  /** As filed (dollars or thousands — see detectValueUnit) */
  value: number;
  sshPrnamt: number;
  sshPrnamtType: "SH" | "PRN";
  putCall: PutCall | null;
  investmentDiscretion: string;
}

const decodeXml = (s: string) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

const tagCache = new Map<string, RegExp>();
/** Text of the first <tag> (any namespace prefix, case-insensitive) in `xml`, or null. */
export function xmlTag(xml: string, tag: string): string | null {
  let re = tagCache.get(tag);
  if (!re) tagCache.set(tag, (re = new RegExp(`<(?:[\\w.-]+:)?${tag}\\b[^>]*>([\\s\\S]*?)</(?:[\\w.-]+:)?${tag}\\s*>`, "i")));
  const m = xml.match(re);
  return m ? decodeXml(m[1]) : null;
}

const num = (s: string | null) => {
  if (s === null) return NaN;
  const n = Number(s.replace(/[,\s$]/g, ""));
  return n;
};

/** Parse every infoTable entry of a 13F information table. Malformed rows are skipped. */
export function parseInfoTable(xml: string): InfoTableEntry[] {
  const out: InfoTableEntry[] = [];
  const re = /<(?:[\w.-]+:)?infoTable\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?infoTable\s*>/gi;
  for (const m of xml.matchAll(re)) {
    const row = m[1];
    const cusip = (xmlTag(row, "cusip") ?? "").toUpperCase().replace(/\s/g, "");
    const value = num(xmlTag(row, "value"));
    const shares = num(xmlTag(row, "sshPrnamt"));
    if (!cusip || !Number.isFinite(value) || !Number.isFinite(shares)) continue;
    const type = (xmlTag(row, "sshPrnamtType") ?? "SH").toUpperCase();
    const pc = (xmlTag(row, "putCall") ?? "").toLowerCase();
    out.push({
      nameOfIssuer: xmlTag(row, "nameOfIssuer") ?? "",
      titleOfClass: xmlTag(row, "titleOfClass") ?? "",
      cusip,
      value,
      sshPrnamt: shares,
      sshPrnamtType: type === "PRN" ? "PRN" : "SH",
      putCall: pc === "put" ? "Put" : pc === "call" ? "Call" : null,
      investmentDiscretion: xmlTag(row, "investmentDiscretion") ?? "",
    });
  }
  return out;
}

/** Cover-page fields from primary_doc.xml. Dates come back as YYYY-MM-DD. */
export interface CoverPage {
  period: string | null;
  isAmendment: boolean;
  amendmentType: "RESTATEMENT" | "NEW HOLDINGS" | null;
  reportType: string | null;
  tableEntryTotal: number | null;
  tableValueTotal: number | null;
}

const mdy = (s: string | null) => {
  const m = s?.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  return m ? `${m[3]}-${m[1]}-${m[2]}` : s;
};

export function parseCoverPage(xml: string): CoverPage {
  const t = (xmlTag(xml, "amendmentType") ?? "").toUpperCase();
  const n = (s: string | null) => (s === null || !Number.isFinite(num(s)) ? null : num(s));
  return {
    period: mdy(xmlTag(xml, "reportCalendarOrQuarter") ?? xmlTag(xml, "periodOfReport")),
    isAmendment: (xmlTag(xml, "isAmendment") ?? "").toLowerCase() === "true",
    amendmentType: t.startsWith("RESTATE") ? "RESTATEMENT" : t.startsWith("NEW") ? "NEW HOLDINGS" : null,
    reportType: xmlTag(xml, "reportType"),
    tableEntryTotal: n(xmlTag(xml, "tableEntryTotal")),
    tableValueTotal: n(xmlTag(xml, "tableValueTotal")),
  };
}

// ── Value units ─────────────────────────────────────────────────────────────

export type ValueUnit = "dollars" | "thousands";
export type UnitBasis = "filing-date" | "report-period" | "implied-price";

/** SEC's amended Form 13F rules: filings made on or after 3 January 2023 report value rounded to the nearest dollar; earlier filings in thousands. */
export const DOLLAR_VALUES_FROM = "2023-01-03";

/**
 * Units of the `value` column. The rule keys on the filing date (falls back to the
 * report period: periods ending 2022-12-31 or later were all filed after the switch).
 * A sanity check on the implied price per share (value ÷ shares, median over common
 * share rows) catches filers that used the other unit: in a "dollars" filing a median under 1
 * means thousands (a $150 stock shows as 0.15); in a "thousands" filing a median over 5 (a $5,000 median share price) means dollars.
 */
export function detectValueUnit(filingDate: string | null, period: string | null, entries: InfoTableEntry[] = []): { unit: ValueUnit; basis: UnitBasis } {
  let unit: ValueUnit;
  let basis: UnitBasis;
  if (filingDate) {
    unit = filingDate >= DOLLAR_VALUES_FROM ? "dollars" : "thousands";
    basis = "filing-date";
  } else {
    unit = period && period >= "2022-12-31" ? "dollars" : "thousands";
    basis = "report-period";
  }
  const prices = entries
    .filter((e) => e.sshPrnamtType === "SH" && !e.putCall && e.sshPrnamt > 0 && e.value > 0)
    .map((e) => e.value / e.sshPrnamt)
    .sort((a, b) => a - b);
  if (prices.length >= 5) {
    const median = prices[Math.floor(prices.length / 2)];
    if (unit === "dollars" && median < 1) return { unit: "thousands", basis: "implied-price" };
    if (unit === "thousands" && median > 5) return { unit: "dollars", basis: "implied-price" };
  }
  return { unit, basis };
}

// ── Aggregation & QoQ diff ──────────────────────────────────────────────────

export type ChangeKind = "new" | "added" | "reduced" | "unchanged";

export interface Position {
  /** CUSIP + put/call */
  key: string;
  cusip: string;
  issuer: string;
  titleOfClass: string;
  putCall: PutCall | null;
  shareType: "SH" | "PRN";
  /** US dollars */
  value: number;
  /** Shares (or principal amount for PRN rows) */
  shares: number;
  /** % of the filing's total reported value */
  weight: number;
}

export interface Holding extends Position {
  change: ChangeKind | null;
  sharesChange: number | null;
  sharesChangePct: number | null;
  priorValue: number | null;
  priorShares: number | null;
  ticker: string | null;
  /** How the ticker was found: SEC company-name match (best effort, CUSIPs aren't mapped) */
  tickerSource: "name" | "cusip" | null;
}

export interface SoldOut {
  key: string;
  cusip: string;
  issuer: string;
  titleOfClass: string;
  putCall: PutCall | null;
  priorValue: number;
  priorShares: number;
  priorWeight: number;
  ticker: string | null;
  tickerSource: "name" | "cusip" | null;
}

export const positionKey = (cusip: string, putCall: PutCall | null) => (putCall ? `${cusip}:${putCall.toUpperCase()}` : cusip);

/**
 * One position per CUSIP and put/call: rows split across other managers or
 * discretion types are summed; puts and calls stay separate from the shares.
 * Values are converted to dollars. Sorted by value, largest first.
 */
export function aggregateHoldings(entries: InfoTableEntry[], unit: ValueUnit): Position[] {
  const mult = unit === "thousands" ? 1000 : 1;
  const map = new Map<string, Position & { classes: Set<string> }>();
  for (const e of entries) {
    const key = positionKey(e.cusip, e.putCall);
    let p = map.get(key);
    if (!p) {
      p = { key, cusip: e.cusip, issuer: e.nameOfIssuer, titleOfClass: "", putCall: e.putCall, shareType: e.sshPrnamtType, value: 0, shares: 0, weight: 0, classes: new Set() };
      map.set(key, p);
    }
    p.value += e.value * mult;
    p.shares += e.sshPrnamt;
    if (e.titleOfClass) p.classes.add(e.titleOfClass);
    if (!p.issuer && e.nameOfIssuer) p.issuer = e.nameOfIssuer;
  }
  const list = [...map.values()];
  const total = list.reduce((s, p) => s + p.value, 0);
  return list
    .map(({ classes, ...p }) => ({ ...p, titleOfClass: [...classes].join(" / "), weight: total > 0 ? (p.value / total) * 100 : 0 }))
    .sort((a, b) => b.value - a.value || a.issuer.localeCompare(b.issuer));
}

/** Combine position lists already in dollars (an original filing plus "new holdings" amendments). */
export function mergePositions(lists: Position[][]): Position[] {
  if (lists.length === 1) return lists[0];
  const entries: InfoTableEntry[] = lists.flat().map((p) => ({
    nameOfIssuer: p.issuer,
    titleOfClass: p.titleOfClass,
    cusip: p.cusip,
    value: p.value,
    sshPrnamt: p.shares,
    sshPrnamtType: p.shareType,
    putCall: p.putCall,
    investmentDiscretion: "",
  }));
  return aggregateHoldings(entries, "dollars");
}

/**
 * Quarter-over-quarter change by share count (values move with prices, so they
 * aren't used to classify). `prior` null → no comparison available.
 */
export function diffHoldings(current: Position[], prior: Position[] | null): { holdings: Omit<Holding, "ticker" | "tickerSource">[]; soldOut: Omit<SoldOut, "ticker" | "tickerSource">[] } {
  if (!prior) {
    return { holdings: current.map((p) => ({ ...p, change: null, sharesChange: null, sharesChangePct: null, priorValue: null, priorShares: null })), soldOut: [] };
  }
  const before = new Map(prior.map((p) => [p.key, p]));
  const holdings = current.map((p) => {
    const b = before.get(p.key);
    if (!b) return { ...p, change: "new" as const, sharesChange: p.shares, sharesChangePct: null, priorValue: null, priorShares: null };
    const d = p.shares - b.shares;
    const change: ChangeKind = d > 0 ? "added" : d < 0 ? "reduced" : "unchanged";
    return { ...p, change, sharesChange: d, sharesChangePct: b.shares > 0 ? Math.round((d / b.shares) * 10_000) / 100 : null, priorValue: b.value, priorShares: b.shares };
  });
  const now = new Set(current.map((p) => p.key));
  const soldOut = prior
    .filter((p) => !now.has(p.key))
    .map((p) => ({ key: p.key, cusip: p.cusip, issuer: p.issuer, titleOfClass: p.titleOfClass, putCall: p.putCall, priorValue: p.value, priorShares: p.shares, priorWeight: p.weight }))
    .sort((a, b) => b.priorValue - a.priorValue);
  return { holdings, soldOut };
}

// ── Filing selection ────────────────────────────────────────────────────────

export interface FilingRow {
  form: string;
  accession: string;
  filed: string;
  period: string;
}

/** 13F-HR filings grouped by report period, newest period first (originals + amendments, by filing date). */
export function thirteenFPeriods(recent: { form?: string[]; accessionNumber?: string[]; filingDate?: string[]; reportDate?: string[] }): Array<{ period: string; filings: FilingRow[] }> {
  const forms = recent.form ?? [];
  const byPeriod = new Map<string, FilingRow[]>();
  forms.forEach((form, i) => {
    if (form !== "13F-HR" && form !== "13F-HR/A") return;
    const period = recent.reportDate?.[i] ?? "";
    const row = { form, accession: recent.accessionNumber?.[i] ?? "", filed: recent.filingDate?.[i] ?? "", period };
    if (!period || !row.accession) return;
    byPeriod.set(period, [...(byPeriod.get(period) ?? []), row]);
  });
  return [...byPeriod.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([period, filings]) => ({ period, filings: filings.sort((a, b) => a.filed.localeCompare(b.filed) || a.accession.localeCompare(b.accession)) }));
}

// ── CUSIP → ticker by company name (best effort) ────────────────────────────

/** SEC/CUSIP abbreviations: full word → the form used in 13F issuer names. */
const ABBREV: Record<string, string> = {
  PETROLEUM: "PETE", FINANCIAL: "FINL", INTERNATIONAL: "INTL", HOLDINGS: "HLDGS", HOLDING: "HLDG", TECHNOLOGIES: "TECHNOLOGIES",
  TECHNOLOGY: "TECHNOLOGY", COMMUNICATIONS: "COMMUNICATIONS", SYSTEMS: "SYS", SERVICES: "SVCS", PHARMACEUTICALS: "PHARMACEUTICALS",
  INDUSTRIES: "INDS", MANAGEMENT: "MGMT", RESOURCES: "RES", PROPERTIES: "PPTYS", AMERICAN: "AMERN", AMERICA: "AMER",
  NATIONAL: "NATL", ENTERTAINMENT: "ENTMT", BANCORPORATION: "BANCORPORATION", LABORATORIES: "LABS", MORTGAGE: "MTG", ENERGY: "ENERGY",
  PARTNERS: "PARTNERS", INVESTMENT: "INVT", INVESTMENTS: "INVTS", ASSOCIATES: "ASSOC", BROTHERS: "BROS", MANUFACTURING: "MFG",
  INSURANCE: "INS", SOLUTIONS: "SOLUTIONS", REALTY: "RLTY", PRODUCTS: "PRODS", DEVELOPMENT: "DEV", ENTERPRISES: "ENTERPRISES",
  ACQUISITION: "ACQUISITION", HEALTHCARE: "HEALTHCARE", GENERAL: "GEN", SOUTHERN: "SOUTHN", NORTHERN: "NORTHN", WESTERN: "WESTN",
  EASTERN: "EASTN", PACIFIC: "PAC", AUTOMOTIVE: "AUTOMOTIVE", MATERIALS: "MATLS", INSTRUMENTS: "INSTRS", CHEMICAL: "CHEM",
};
const STOP = new Set([
  "THE", "OF", "AND", "INC", "INCORPORATED", "CORP", "CORPORATION", "CO", "COMPANY", "LTD", "LIMITED", "PLC", "LLC", "LP", "L", "P",
  "NV", "N", "V", "SA", "AG", "SE", "AB", "ASA", "SPA", "BV", "DE", "DEL", "NEW", "THE", "CL", "COM", "A", "ADR", "ADS", "SPONSORED", "SPON",
  "ORD", "SHS", "REIT", "TR", "TRUST", "COS", "COMPANIES",
]);

/** Normalized issuer name: upper case, punctuation and legal suffixes removed, common words abbreviated the CUSIP way. */
export function normalizeIssuer(name: string): string {
  return name
    .toUpperCase()
    .replace(/\/[A-Z]{2,3}\/?/g, " ") // "/DE/", "/MD/" state-of-incorporation tags
    .replace(/&/g, " AND ")
    .replace(/['’`.]/g, "")
    .replace(/[^A-Z0-9]+/g, " ")
    .split(" ")
    .filter((w) => w && !STOP.has(w))
    .map((w) => ABBREV[w] ?? w)
    .join(" ");
}

export interface CompanyTicker {
  cik_str: number;
  ticker: string;
  title: string;
}

export interface NameIndex {
  /** normalized name → CIK → tickers in SEC's order */
  exact: Map<string, Map<number, string[]>>;
  /** spaces removed → same */
  compact: Map<string, Map<number, string[]>>;
  /** first token → candidate names (for the abbreviation-prefix fallback) */
  byFirst: Map<string, Array<{ words: string[]; cik: number; tickers: string[] }>>;
}

/** Index SEC's company_tickers.json (`{ "0": {cik_str, ticker, title}, … }`) by normalized company name. */
export function buildNameIndex(rows: CompanyTicker[]): NameIndex {
  const exact: NameIndex["exact"] = new Map();
  const compact: NameIndex["compact"] = new Map();
  const tickersByCik = new Map<number, { title: string; tickers: string[] }>();
  for (const r of rows) {
    const t = tickersByCik.get(r.cik_str);
    if (t) t.tickers.push(r.ticker);
    else tickersByCik.set(r.cik_str, { title: r.title, tickers: [r.ticker] });
  }
  const byFirst: NameIndex["byFirst"] = new Map();
  for (const [cik, { title, tickers }] of tickersByCik) {
    const norm = normalizeIssuer(title);
    if (!norm) continue;
    for (const [map, key] of [[exact, norm], [compact, norm.replace(/ /g, "")]] as const) {
      const m = map.get(key) ?? new Map<number, string[]>();
      m.set(cik, tickers);
      map.set(key, m);
    }
    const words = norm.split(" ");
    byFirst.set(words[0], [...(byFirst.get(words[0]) ?? []), { words, cik, tickers }]);
  }
  return { exact, compact, byFirst };
}

/** "CL A" / "CLASS B" / "SER C" → "A" / "B" / "C" */
const classLetter = (title: string) => title.toUpperCase().match(/\b(?:CL|CLASS|SER|SERIES)\s*([A-Z])\b/)?.[1] ?? null;

/**
 * The company's common-stock tickers: drops preferreds ("BAC-PB"), warrants/units/rights
 * ("XYZ-WT") and listed notes / preferreds that extend another ticker ("BACRP", "GOOGN").
 * SEC lists the primary listing first, which is always kept.
 */
export function commonTickers(tickers: string[]): string[] {
  return tickers.filter((t, i) => {
    if (i === 0) return true;
    if (/-P[A-Z]*$/.test(t) || /-(W|WS|WT|U|UN|R|RT)$/.test(t)) return false;
    // OTC foreign ordinaries / ADRs ("TCKRF") listed next to the primary US ticker
    if (/^[A-Z]{4}[FY]$/.test(t)) return false;
    if (/[-.][A-Z]$/.test(t)) return true; // share class: "LEN-B", "BRK.A"
    return !tickers.some((u) => u !== t && u.length < t.length && t.startsWith(u));
  });
}

/** Two tickers for share classes of one company: "BRK-A"/"BRK-B", "FOX"/"FOXA", "LLYVA"/"LLYVK". */
const siblings = (a: string, b: string) =>
  a !== b && (/[-.][A-Z]$/.test(a) || b === a + b.slice(-1) || a === b + a.slice(-1) || (a.length === b.length && a.length >= 4 && a.slice(0, -1) === b.slice(0, -1)));

function pickTicker(all: string[], titleOfClass: string): string | null {
  const tickers = commonTickers(all);
  // Multi-series trusts (e.g. iShares Trust) list many funds under one name — can't tell which.
  if (tickers.length > 3) return null;
  if (tickers.length === 1 || !tickers.some((a) => tickers.some((b) => siblings(a, b)))) return tickers[0];
  // Several listed share classes: answer only when the title names the class and a ticker carries it.
  const letter = classLetter(titleOfClass);
  if (!letter) return null;
  return (
    tickers.find((t) => new RegExp(`[-.]${letter}$`).test(t)) ??
    tickers.find((t) => t.endsWith(letter) && tickers.some((u) => siblings(t, u))) ??
    null
  );
}

/**
 * The few CUSIPs whose share class can't be told apart by name (verified against
 * 13F filings): Alphabet class A and class C.
 */
export const KNOWN_CUSIPS: Record<string, string> = {
  "02079K305": "GOOGL",
  "02079K107": "GOOG",
};

const NON_EQUITY = /\b(NOTE|NOTES|DEBT|BOND|BD|DEB|DBCV|SDCV|CONV|WARRANT|WARRANTS|WT|WTS|RIGHT|RIGHTS|RT|PFD|PREF|PREFERRED|UNIT|UNITS)\b|\bEXP\b/;
const LEGAL_SUFFIXES = ["INCORPORATED", "CORPORATION", "COMPANY", "LIMITED", "HOLDINGS", "HLDGS", "GROUP", "PLC"];

const FULL_WORD: Record<string, string> = Object.fromEntries(Object.entries(ABBREV).map(([full, short]) => [short, full]));
const isSubsequence = (short: string, long: string) => {
  let i = 0;
  for (const ch of long) if (ch === short[i]) i++;
  return i === short.length;
};
/**
 * Whether two name words are plausibly the same word abbreviated or truncated:
 * "PETE"/"PETROLEUM", "MTRS"/"MOTORS", "HLDNGS"/"HLDGS", "MANUFAC"/"MFG" (via MANUFACTURING).
 * Same first letter required.
 */
export function wordLike(a: string, b: string): boolean {
  if (a === b) return true;
  // Numbers and roman numerals tell funds / SPACs apart ("PARTNERS II" ≠ "PARTNERS I").
  if (/\d|^[IVX]+$/.test(a) || /\d|^[IVX]+$/.test(b)) return false;
  const forms = (w: string) => [w, FULL_WORD[w]].filter(Boolean) as string[];
  for (const x of forms(a))
    for (const y of forms(b)) {
      if (x === y) return true;
      if (x[0] !== y[0]) continue;
      if (x.startsWith(y) || y.startsWith(x)) return true;
      if ((x.length >= 3 && x.length < y.length && isSubsequence(x, y)) || (y.length >= 3 && y.length < x.length && isSubsequence(y, x))) return true;
    }
  return false;
}

export interface TickerMatch {
  ticker: string;
  /** "name": matched by issuer name (best effort); "cusip": one of KNOWN_CUSIPS */
  source: "name" | "cusip";
}

/**
 * Ticker for a 13F position — by issuer-name match against SEC company_tickers.json.
 * Returns null rather than guess: debt / warrants / preferreds are skipped, as are
 * names shared by several SEC registrants, multi-series trusts and share classes
 * that can't be told apart.
 */
export function matchTicker(index: NameIndex, p: { issuer: string; titleOfClass?: string; shareType?: "SH" | "PRN"; cusip?: string }): TickerMatch | null {
  const cls = (p.titleOfClass ?? "").toUpperCase();
  if (p.shareType === "PRN" || NON_EQUITY.test(cls)) return null;
  if (p.cusip && KNOWN_CUSIPS[p.cusip]) return { ticker: KNOWN_CUSIPS[p.cusip], source: "cusip" };
  const unique = (m: Map<number, string[]> | undefined) => (m && m.size === 1 ? [...m.values()][0] : null);
  const lookup = (norm: string): string[] | null => {
    if (!norm) return null;
    const hit = unique(index.exact.get(norm)) ?? unique(index.compact.get(norm.replace(/ /g, "")));
    if (hit || index.exact.has(norm)) return hit;
    // Abbreviation fallback: each word of the 13F name is a prefix of the SEC name's word ("OCCIDENTAL PETE" ~ "OCCIDENTAL PETROLEUM").
    const words = norm.split(" ");
    const cands = (index.byFirst.get(words[0]) ?? []).filter(
      (c) => c.words.length === words.length && c.words.every((w, i) => wordLike(words[i], w)),
    );
    return new Set(cands.map((c) => c.cik)).size === 1 ? cands[0].tickers : null;
  };
  let tickers = lookup(normalizeIssuer(p.issuer));
  if (!tickers) {
    // 13F names are cut at ~28 characters: "JEFFERIES FINANCIAL GROUP IN" — drop a truncated legal suffix.
    const raw = p.issuer.trim().toUpperCase().split(/\s+/);
    const last = raw[raw.length - 1] ?? "";
    if (p.issuer.trim().length >= 24 && raw.length > 1 && LEGAL_SUFFIXES.some((s) => s !== last && s.startsWith(last))) {
      tickers = lookup(normalizeIssuer(raw.slice(0, -1).join(" ")));
    }
  }
  const ticker = tickers ? pickTicker(tickers, cls) : null;
  return ticker ? { ticker, source: "name" } : null;
}

// ── API shapes ──────────────────────────────────────────────────────────────

export interface FilingRef {
  accession: string;
  form: string;
  filed: string;
  period: string;
  /** EDGAR filing index page */
  url: string;
  infoTableUrl: string | null;
  valueUnit: ValueUnit;
  unitBasis: UnitBasis;
  /** Amendments folded in (restatement replaces, new-holdings adds) */
  amendments: string[];
}

export interface ManagerHoldings {
  cik: string;
  label: string;
  note: string;
  /** Registrant name on EDGAR */
  name: string;
  latest: FilingRef;
  prior: FilingRef | null;
  totalValue: number;
  priorTotalValue: number | null;
  positionCount: number;
  counts: { new: number; added: number; reduced: number; unchanged: number; soldOut: number };
  holdings: Holding[];
  soldOut: SoldOut[];
  /** Positions omitted by the `limit` query parameter */
  truncated: number;
  fetchedAt: string;
  caveats: string[];
}

export interface ManagerSummary {
  cik: string;
  label: string;
  note: string;
  status: "ready" | "loading" | "error" | "none";
  error?: string;
  name?: string;
  period?: string;
  filed?: string;
  totalValue?: number;
  positionCount?: number;
  top?: Array<{ issuer: string; ticker: string | null; putCall: PutCall | null; weight: number }>;
  filingUrl?: string;
}

export interface FundHolder {
  cik: string;
  label: string;
  period: string;
  filingUrl: string;
  issuer: string;
  putCall: PutCall | null;
  value: number;
  shares: number;
  weight: number;
  rank: number;
  change: ChangeKind | null;
  sharesChangePct: number | null;
}
