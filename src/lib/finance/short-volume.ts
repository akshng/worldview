/**
 * FINRA Reg SHO daily short sale volume (consolidated NMS file, keyless).
 * Off-exchange (FINRA-reported) volume only — not short interest, and not total
 * market volume. Daily files are cached in memory once loaded.
 */
import "server-only";
import { userAgent } from "@/lib/env";

export interface ShortDay {
  date: string;
  shortVolume: number;
  totalVolume: number;
  shortPct: number;
}

export interface ShortVolume {
  symbol: string;
  days: ShortDay[];
  source: string;
  note: string;
}

type DayFile = Map<string, { s: number; t: number }>;

/** Parse one CNMSshvolYYYYMMDD.txt file into symbol → volumes. */
export function parseShortFile(text: string): DayFile {
  const out: DayFile = new Map();
  for (const line of text.split(/\r?\n/).slice(1)) {
    const [, symbol, sv, , tv] = line.split("|");
    const s = Number(sv), t = Number(tv);
    if (symbol && Number.isFinite(s) && Number.isFinite(t) && t > 0) out.set(symbol, { s, t });
  }
  return out;
}

/** Yahoo-style symbol → FINRA symbol (BRK-B → BRK.B); null for non-US instruments. */
export function finraSymbol(symbol: string): string | null {
  if (/[\^=]/.test(symbol) || /\.[A-Z]{1,3}$/.test(symbol) || /-USD$/.test(symbol)) return null;
  return symbol.toUpperCase().replace(/-/g, ".");
}

const g = globalThis as unknown as { __worldviewShortFiles?: Map<string, { at: number; file: DayFile | null }> };
const files = (g.__worldviewShortFiles ??= new Map());

async function dayFile(yyyymmdd: string): Promise<DayFile | null> {
  const hit = files.get(yyyymmdd);
  // Missing files (holidays, not yet published) are retried after an hour.
  if (hit && (hit.file || Date.now() - hit.at < 3_600_000)) return hit.file;
  let file: DayFile | null = null;
  try {
    const res = await fetch(`https://cdn.finra.org/equity/regsho/daily/CNMSshvol${yyyymmdd}.txt`, {
      headers: { "User-Agent": userAgent() },
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
    });
    if (res.ok) file = parseShortFile(await res.text());
  } catch {
    file = null;
  }
  files.set(yyyymmdd, { at: Date.now(), file });
  if (files.size > 40) files.delete([...files.keys()].sort()[0]);
  return file;
}

export async function getShortVolume(symbol: string, sessions = 10): Promise<ShortVolume> {
  const fin = finraSymbol(symbol);
  const base: ShortVolume = {
    symbol,
    days: [],
    source: "FINRA Reg SHO daily short sale volume",
    note: "Share of FINRA-reported (off-exchange) volume that was sold short each day. Not short interest; a high ratio is common and not by itself bearish.",
  };
  if (!fin) return base;
  const dates: string[] = [];
  for (let d = new Date(); dates.length < sessions + 4; d = new Date(d.getTime() - 86_400_000)) {
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) dates.push(d.toISOString().slice(0, 10).replace(/-/g, ""));
  }
  const loaded = await Promise.all(dates.map(async (ds) => ({ ds, file: await dayFile(ds) })));
  for (const { ds, file } of loaded) {
    const row = file?.get(fin);
    if (!row) continue;
    base.days.push({ date: `${ds.slice(0, 4)}-${ds.slice(4, 6)}-${ds.slice(6)}`, shortVolume: Math.round(row.s), totalVolume: Math.round(row.t), shortPct: Math.round((row.s / row.t) * 1000) / 10 });
  }
  base.days = base.days.sort((a, b) => a.date.localeCompare(b.date)).slice(-sessions);
  return base;
}
