/**
 * 13F holdings for the curated managers in TRACKED_MANAGERS, from SEC EDGAR.
 *
 * Per manager: data.sec.gov submissions → the latest two 13F-HR report periods →
 * for each filing the Archives index.json, primary_doc.xml (cover page) and the
 * information-table XML. Requires WORLDVIEW_CONTACT (www.sec.gov/Archives rejects
 * clients without a contact in the User-Agent).
 *
 * SEC fair access: every request goes through one throttle (≤ 8 req/s). Caching:
 *  - parsed filings are immutable → DATA_DIR/13f/filing-<accession>.json, kept forever
 *  - submissions and company_tickers.json → memory + DATA_DIR/13f/, 24 h
 *  - computed manager holdings → memory, 24 h (served stale while refreshing)
 * Managers load in the background; list/by-ticker return what is ready plus a pending count.
 */
import "server-only";
import path from "node:path";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { env, userAgent } from "@/lib/env";
import {
  TRACKED_MANAGERS,
  THIRTEENF_CAVEATS,
  aggregateHoldings,
  buildNameIndex,
  detectValueUnit,
  diffHoldings,
  matchTicker,
  mergePositions,
  parseCoverPage,
  parseInfoTable,
  thirteenFPeriods,
  type CompanyTicker,
  type CoverPage,
  type FilingRef,
  type FilingRow,
  type FundHolder,
  type ManagerHoldings,
  type ManagerSummary,
  type NameIndex,
  type Position,
  type TickerMatch,
  type TrackedManager,
  type UnitBasis,
  type ValueUnit,
} from "./thirteenf";

const DAY = 24 * 3_600_000;
const RETRY_ERROR_MS = 15 * 60_000;
const MIN_GAP_MS = 125; // ≤ 8 requests per second across all 13F traffic

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Entry = { at: number; data: ManagerHoldings | null; error: string | null; none?: boolean };
const g = globalThis as unknown as {
  __worldview13f?: {
    nextSlot: number;
    managers: Map<string, Entry>;
    inflight: Map<string, Promise<void>>;
    active: number;
    queue: Array<() => void>;
    names: { at: number; index: NameIndex } | null;
    namesLoading: Promise<NameIndex | null> | null;
  };
};
const st: NonNullable<typeof g.__worldview13f> = (g.__worldview13f ??= { nextSlot: 0, managers: new Map(), inflight: new Map(), active: 0, queue: [], names: null, namesLoading: null });

export class ContactMissingError extends Error {
  constructor() {
    super("13F holdings need WORLDVIEW_CONTACT (an email for SEC's User-Agent policy) — set it in .env.local.");
  }
}

async function secFetch(url: string): Promise<Response> {
  if (!env().WORLDVIEW_CONTACT) throw new ContactMissingError();
  for (let attempt = 0; ; attempt++) {
    const now = Date.now();
    const slot = Math.max(now, st.nextSlot);
    st.nextSlot = slot + MIN_GAP_MS;
    if (slot > now) await sleep(slot - now);
    const res = await fetch(url, { headers: { "User-Agent": userAgent(), "Accept-Encoding": "gzip, deflate" }, signal: AbortSignal.timeout(120_000), cache: "no-store" });
    if ((res.status === 429 || res.status === 503) && attempt < 2) {
      await sleep(2000 * (attempt + 1));
      continue;
    }
    if (!res.ok) throw new Error(`SEC HTTP ${res.status} for ${new URL(url).pathname}`);
    return res;
  }
}

// ── Disk cache ──────────────────────────────────────────────────────────────

const dir = () => path.resolve(process.cwd(), env().DATA_DIR, "13f");
async function readDisk<T>(name: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path.join(dir(), name), "utf8")) as T;
  } catch {
    return null;
  }
}
async function writeDisk(name: string, data: unknown): Promise<void> {
  try {
    await mkdir(dir(), { recursive: true });
    const file = path.join(dir(), name);
    const tmp = `${file}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(data));
    await rename(tmp, file);
  } catch (err) {
    console.warn("[13f] cache write failed:", (err as Error).message);
  }
}

// ── Submissions ─────────────────────────────────────────────────────────────

interface Submissions {
  at: number;
  name: string;
  filings: FilingRow[];
}

async function submissions(cik: string): Promise<Submissions> {
  const name = `submissions-${cik}.json`;
  const disk = await readDisk<Submissions>(name);
  if (disk && Date.now() - disk.at < DAY) return disk;
  const j = (await (await secFetch(`https://data.sec.gov/submissions/CIK${cik.padStart(10, "0")}.json`)).json()) as {
    name?: string;
    filings?: { recent?: Parameters<typeof thirteenFPeriods>[0] };
  };
  const periods = thirteenFPeriods(j.filings?.recent ?? {});
  const s: Submissions = { at: Date.now(), name: j.name ?? cik, filings: periods.slice(0, 3).flatMap((p) => p.filings) };
  await writeDisk(name, s);
  return s;
}

// ── One filing (immutable) ──────────────────────────────────────────────────

interface FilingData {
  v: 1;
  accession: string;
  form: string;
  filed: string;
  period: string;
  cover: CoverPage;
  infoTable: string | null;
  valueUnit: ValueUnit;
  unitBasis: UnitBasis;
  positions: Position[];
}

const archiveBase = (cik: string, accession: string) => `https://www.sec.gov/Archives/edgar/data/${cik}/${accession.replace(/-/g, "")}/`;
export const filingIndexUrl = (cik: string, accession: string) => `${archiveBase(cik, accession)}${accession}-index.html`;

async function filingData(cik: string, row: FilingRow): Promise<FilingData> {
  const name = `filing-${row.accession}.json`;
  const disk = await readDisk<FilingData>(name);
  if (disk?.v === 1) return disk;
  const base = archiveBase(cik, row.accession);
  const idx = (await (await secFetch(`${base}index.json`)).json()) as { directory?: { item?: Array<{ name: string; size?: string }> } };
  const items = idx.directory?.item ?? [];
  const xmls = items.filter((i) => /\.xml$/i.test(i.name));
  const primary = xmls.find((i) => /primary_doc\.xml$/i.test(i.name));
  const table = xmls.filter((i) => i !== primary).sort((a, b) => Number(b.size || 0) - Number(a.size || 0))[0];
  const cover = primary ? parseCoverPage(await (await secFetch(base + primary.name)).text()) : parseCoverPage("");
  const entries = table ? parseInfoTable(await (await secFetch(base + table.name)).text()) : [];
  const period = cover.period ?? row.period;
  const { unit, basis } = detectValueUnit(row.filed, period, entries);
  const data: FilingData = {
    v: 1,
    accession: row.accession,
    form: row.form,
    filed: row.filed,
    period,
    cover,
    infoTable: table ? base + table.name : null,
    valueUnit: unit,
    unitBasis: basis,
    positions: aggregateHoldings(entries, unit),
  };
  await writeDisk(name, data);
  return data;
}

/**
 * The holdings for one report period: the newest restatement (or the original),
 * plus any "new holdings" amendments filed after it. Other amendment types are ignored.
 */
async function resolvePeriod(cik: string, rows: FilingRow[]): Promise<{ ref: FilingRef; positions: Position[] } | null> {
  const additions: FilingData[] = [];
  for (const row of [...rows].reverse()) {
    const f = await filingData(cik, row);
    if (f.form === "13F-HR" || f.cover.amendmentType === "RESTATEMENT") {
      const parts = [f, ...additions.reverse()];
      return {
        ref: {
          accession: f.accession,
          form: f.form,
          filed: f.filed,
          period: f.period,
          url: filingIndexUrl(cik, f.accession),
          infoTableUrl: f.infoTable,
          valueUnit: f.valueUnit,
          unitBasis: f.unitBasis,
          amendments: additions.map((a) => a.accession),
        },
        positions: mergePositions(parts.map((p) => p.positions)),
      };
    }
    if (f.cover.amendmentType === "NEW HOLDINGS") additions.push(f);
  }
  return null;
}

// ── Ticker names ────────────────────────────────────────────────────────────

async function nameIndex(): Promise<NameIndex | null> {
  if (st.names && Date.now() - st.names.at < DAY) return st.names.index;
  st.namesLoading ??= (async () => {
    try {
      let disk = await readDisk<{ at: number; rows: CompanyTicker[] }>("company-tickers.json");
      if (!disk || Date.now() - disk.at > DAY) {
        const j = (await (await secFetch("https://www.sec.gov/files/company_tickers.json")).json()) as Record<string, CompanyTicker>;
        disk = { at: Date.now(), rows: Object.values(j) };
        await writeDisk("company-tickers.json", disk);
      }
      st.names = { at: disk.at, index: buildNameIndex(disk.rows) };
      return st.names.index;
    } catch (err) {
      console.warn("[13f] company_tickers unavailable:", (err as Error).message);
      return st.names?.index ?? null;
    } finally {
      st.namesLoading = null;
    }
  })();
  return st.namesLoading;
}

// ── Manager holdings ────────────────────────────────────────────────────────

async function computeManager(m: TrackedManager): Promise<ManagerHoldings | null> {
  const subs = await submissions(m.cik);
  const periods = thirteenFPeriods({
    form: subs.filings.map((f) => f.form),
    accessionNumber: subs.filings.map((f) => f.accession),
    filingDate: subs.filings.map((f) => f.filed),
    reportDate: subs.filings.map((f) => f.period),
  });
  if (!periods.length) return null;
  const latest = await resolvePeriod(m.cik, periods[0].filings);
  if (!latest) return null;
  const prior = periods[1] ? await resolvePeriod(m.cik, periods[1].filings).catch(() => null) : null;
  const names = await nameIndex();
  const memo = new Map<string, TickerMatch | null>();
  const tick = (p: { issuer: string; titleOfClass: string; shareType: "SH" | "PRN"; cusip: string }) => {
    if (!names) return { ticker: null, tickerSource: null };
    const k = `${p.cusip}|${p.issuer}|${p.titleOfClass}|${p.shareType}`;
    if (!memo.has(k)) memo.set(k, matchTicker(names, p));
    const m = memo.get(k);
    return { ticker: m?.ticker ?? null, tickerSource: m?.source ?? null };
  };
  const { holdings, soldOut } = diffHoldings(latest.positions, prior?.positions ?? null);
  const withTicker = holdings.map((h) => ({ ...h, ...tick(h) }));
  const sold = soldOut.map((s) => ({ ...s, ...tick({ ...s, shareType: "SH" }) }));
  const count = (k: string) => withTicker.filter((h) => h.change === k).length;
  return {
    cik: m.cik,
    label: m.label,
    note: m.note,
    name: subs.name,
    latest: latest.ref,
    prior: prior?.ref ?? null,
    totalValue: latest.positions.reduce((s, p) => s + p.value, 0),
    priorTotalValue: prior ? prior.positions.reduce((s, p) => s + p.value, 0) : null,
    positionCount: latest.positions.length,
    counts: { new: count("new"), added: count("added"), reduced: count("reduced"), unchanged: count("unchanged"), soldOut: sold.length },
    holdings: withTicker,
    soldOut: sold,
    truncated: 0,
    fetchedAt: new Date().toISOString(),
    caveats: THIRTEENF_CAVEATS,
  };
}

/** At most 3 managers load at once (large filers' info tables run to tens of MB). */
async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (st.active >= 3) await new Promise<void>((r) => st.queue.push(r));
  st.active++;
  try {
    return await fn();
  } finally {
    st.active--;
    st.queue.shift()?.();
  }
}

function needsLoad(e: Entry | undefined): boolean {
  if (!e) return true;
  if (e.data || e.none) return Date.now() - e.at > DAY;
  return Date.now() - e.at > RETRY_ERROR_MS;
}

/** Start (or join) a background load for a manager. */
function ensure(m: TrackedManager): Promise<void> {
  const running = st.inflight.get(m.cik);
  if (running) return running;
  if (!needsLoad(st.managers.get(m.cik))) return Promise.resolve();
  const p = withSlot(() => computeManager(m))
    .then((data) => {
      st.managers.set(m.cik, { at: Date.now(), data, error: null, none: !data });
    })
    .catch((err: Error) => {
      const prev = st.managers.get(m.cik);
      // Keep serving the previous holdings if a refresh fails.
      st.managers.set(m.cik, { at: Date.now(), data: prev?.data ?? null, error: err.message });
      if (!(err instanceof ContactMissingError)) console.warn(`[13f] ${m.label}:`, err.message);
    })
    .finally(() => st.inflight.delete(m.cik));
  st.inflight.set(m.cik, p);
  return p;
}

const findManager = (cik: string) => TRACKED_MANAGERS.find((m) => m.cik === cik.replace(/^0+/, ""));

async function settle(promises: Promise<void>[], waitMs: number) {
  await Promise.race([Promise.allSettled(promises), sleep(waitMs)]);
}

function summary(m: TrackedManager): ManagerSummary {
  const e = st.managers.get(m.cik);
  const base = { cik: m.cik, label: m.label, note: m.note };
  if (e?.data) {
    const d = e.data;
    return {
      ...base,
      status: "ready",
      name: d.name,
      period: d.latest.period,
      filed: d.latest.filed,
      totalValue: d.totalValue,
      positionCount: d.positionCount,
      top: d.holdings.slice(0, 3).map((h) => ({ issuer: h.issuer, ticker: h.ticker, putCall: h.putCall, weight: h.weight })),
      filingUrl: d.latest.url,
    };
  }
  if (st.inflight.has(m.cik) || !e) return { ...base, status: "loading" };
  if (e.none) return { ...base, status: "none" };
  return { ...base, status: "error", error: e.error ?? "Unavailable" };
}

export async function listManagers(): Promise<{ managers: ManagerSummary[]; pending: number; caveats: string[]; source: string }> {
  if (!env().WORLDVIEW_CONTACT) throw new ContactMissingError();
  const jobs = TRACKED_MANAGERS.map(ensure);
  await settle(jobs, 4000);
  const managers = TRACKED_MANAGERS.map(summary);
  return {
    managers,
    pending: managers.filter((m) => m.status === "loading").length,
    caveats: THIRTEENF_CAVEATS,
    source: "SEC EDGAR Form 13F-HR information tables",
  };
}

export async function managerHoldings(cik: string, limit = 250): Promise<ManagerHoldings | null> {
  const m = findManager(cik);
  if (!m) return null;
  await ensure(m);
  const e = st.managers.get(m.cik);
  if (!e?.data) {
    if (e?.error) throw new Error(e.error);
    return null;
  }
  const d = e.data;
  return { ...d, holdings: d.holdings.slice(0, limit), truncated: Math.max(0, d.holdings.length - limit), soldOut: d.soldOut.slice(0, 100) };
}

export function isTracked(cik: string): boolean {
  return !!findManager(cik);
}

/** Tracked managers whose latest 13F holds `ticker` (name-matched), largest first. */
export async function holdersOf(ticker: string): Promise<{ ticker: string; holders: FundHolder[]; checked: number; total: number; pending: number; caveats: string[] }> {
  if (!env().WORLDVIEW_CONTACT) throw new ContactMissingError();
  const t = ticker.toUpperCase();
  const jobs = TRACKED_MANAGERS.map(ensure);
  await settle(jobs, 3000);
  const holders: FundHolder[] = [];
  let checked = 0;
  for (const m of TRACKED_MANAGERS) {
    const d = st.managers.get(m.cik)?.data;
    if (!d) continue;
    checked++;
    d.holdings.forEach((h, i) => {
      if (h.ticker !== t) return;
      holders.push({
        cik: m.cik,
        label: m.label,
        period: d.latest.period,
        filingUrl: d.latest.url,
        issuer: h.issuer,
        putCall: h.putCall,
        value: h.value,
        shares: h.shares,
        weight: h.weight,
        rank: i + 1,
        change: h.change,
        sharesChangePct: h.sharesChangePct,
      });
    });
  }
  holders.sort((a, b) => b.value - a.value);
  return { ticker: t, holders, checked, total: TRACKED_MANAGERS.length, pending: st.inflight.size, caveats: THIRTEENF_CAVEATS };
}
