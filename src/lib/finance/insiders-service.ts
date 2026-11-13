/** Fetches recent Form 4 filings for a company (cached: each filing on disk forever, summaries 6 h). */
import "server-only";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { env } from "@/lib/env";
import { globalLru } from "@/lib/server/lru";
import { cikForTicker } from "./company";
import { secFetch } from "./thirteenf-service";
import { parseForm4, summarizeInsiders, type InsiderSummary, type InsiderTrade } from "./insiders";

const MAX_FILINGS = 30;
/** ticker|days → summary; bounded (keys come from user input). */
const mem = globalLru<string, { at: number; v: Promise<InsiderSummary | null> }>("__worldviewInsiders", 300);
const dir = () => path.resolve(process.cwd(), env().DATA_DIR, "insiders");

async function filingTrades(cik: string, acc: string, doc: string, filed: string): Promise<InsiderTrade[]> {
  const file = path.join(dir(), `${acc}.json`);
  try {
    return JSON.parse(await readFile(file, "utf8")) as InsiderTrade[];
  } catch {
    /* not cached */
  }
  const folder = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${acc.replace(/-/g, "")}`;
  // primaryDocument is the XSL-rendered view ("xslF345X05/x.xml"); the raw XML sits beside it.
  const raw = doc.replace(/^xsl[^/]+\//, "");
  const xml = await (await secFetch(`${folder}/${raw}`)).text();
  const trades = parseForm4(xml, filed, `${folder}/${acc}-index.htm`);
  await mkdir(dir(), { recursive: true }).catch(() => {});
  await writeFile(file, JSON.stringify(trades)).catch(() => {});
  return trades;
}

async function load(ticker: string, days: number): Promise<InsiderSummary | null> {
  const cik = await cikForTicker(ticker);
  if (!cik) return null;
  const sub = (await (await secFetch(`https://data.sec.gov/submissions/CIK${cik}.json`)).json()) as { filings?: { recent?: Record<string, string[]> } };
  const r = sub.filings?.recent ?? {};
  const cutoff = Date.now() - days * 86_400_000;
  const picks: Array<{ acc: string; doc: string; filed: string }> = [];
  for (let i = 0; i < (r.form?.length ?? 0) && picks.length < MAX_FILINGS; i++) {
    if (r.form[i] !== "4" || Date.parse(r.filingDate[i]) < cutoff) continue;
    picks.push({ acc: r.accessionNumber[i], doc: r.primaryDocument[i], filed: r.filingDate[i] });
  }
  const trades: InsiderTrade[] = [];
  for (const p of picks) {
    try {
      trades.push(...(await filingTrades(cik, p.acc, p.doc, p.filed)));
    } catch (e) {
      console.warn(`[insiders] ${ticker} ${p.acc}: ${e instanceof Error ? e.message : e}`);
    }
  }
  return summarizeInsiders(ticker.toUpperCase(), cik, trades, days);
}

/** Open-market insider buys/sells in the last `days` days (SEC Form 4). Null when the ticker has no SEC filer. */
export function insiderActivity(ticker: string, days = 90): Promise<InsiderSummary | null> {
  const key = `${ticker.toUpperCase()}|${days}`;
  const hit = mem.get(key);
  if (hit && Date.now() - hit.at < 6 * 3_600_000) return hit.v;
  const v = load(ticker, days).catch((e) => {
    mem.delete(key);
    throw e;
  });
  mem.set(key, { at: Date.now(), v });
  return v;
}
