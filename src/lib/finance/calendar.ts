/**
 * Economic calendar from official, keyless schedules:
 *  - BLS news release schedule (ICS): jobs, CPI, PPI, JOLTS, …
 *  - BEA release dates (JSON): GDP, personal income & outlays (PCE), trade, …
 *  - U.S. Treasury upcoming auctions (Fiscal Data API)
 * Only scheduled dates are shown — never forecasts or consensus numbers.
 */
import "server-only";
import { userAgent } from "@/lib/env";

export interface CalendarItem {
  id: string;
  at: string;
  title: string;
  agency: "BLS" | "BEA" | "Treasury";
  importance: "high" | "medium" | "low";
  url: string;
  detail: string | null;
}

const HIGH = [/^Employment Situation$/i, /^Consumer Price Index$/i, /^Gross Domestic Product$/i, /^Personal Income and Outlays$/i, /^Producer Price Index$/i];
const MEDIUM = [/Job Openings/i, /Employment Cost Index/i, /Real Earnings/i, /International Trade in Goods and Services/i, /Productivity and Costs/i, /Import and Export Price/i, /Corporate Profits/i, /State Employment/i];

export function importanceOf(title: string): CalendarItem["importance"] {
  if (HIGH.some((r) => r.test(title.trim()))) return "high";
  if (MEDIUM.some((r) => r.test(title))) return "medium";
  return "low";
}

/** US-Eastern wall-clock time → UTC, using the platform time-zone database (handles DST). */
export function easternToUtc(y: number, mo: number, d: number, h: number, mi: number): Date {
  const guess = Date.UTC(y, mo - 1, d, h + 5, mi); // assume EST, then correct
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
    .formatToParts(new Date(guess))
    .reduce<Record<string, number>>((a, p) => (p.type !== "literal" ? { ...a, [p.type]: Number(p.value) % (p.type === "hour" ? 24 : Infinity) } : a), {});
  const shown = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
  return new Date(guess + (Date.UTC(y, mo - 1, d, h, mi) - shown));
}

/** Minimal ICS VEVENT parser for the BLS schedule (times are US-Eastern). */
export function parseBlsIcs(ics: string): CalendarItem[] {
  const out: CalendarItem[] = [];
  for (const block of ics.split("BEGIN:VEVENT").slice(1)) {
    const unfolded = block.replace(/\r?\n[ \t]/g, "");
    const dt = unfolded.match(/DTSTART;TZID=US-Eastern:(\d{8})T(\d{6})/);
    const summary = unfolded.match(/\nSUMMARY:(.+)/)?.[1]?.trim();
    const uid = unfolded.match(/\nUID:(.+)/)?.[1]?.trim();
    if (!dt || !summary) continue;
    const [d, t] = [dt[1], dt[2]];
    const at = easternToUtc(+d.slice(0, 4), +d.slice(4, 6), +d.slice(6, 8), +t.slice(0, 2), +t.slice(2, 4));
    out.push({
      id: `bls:${uid ?? `${d}${summary}`}`,
      at: at.toISOString(),
      title: summary.replace(/\\,/g, ","),
      agency: "BLS",
      importance: importanceOf(summary),
      url: "https://www.bls.gov/schedule/news_release/",
      detail: null,
    });
  }
  return out;
}

export function parseBea(json: Record<string, { release_dates?: string[] } | string>): CalendarItem[] {
  const out: CalendarItem[] = [];
  for (const [title, v] of Object.entries(json)) {
    if (typeof v !== "object" || !v?.release_dates) continue;
    for (const at of new Set(v.release_dates)) {
      out.push({ id: `bea:${title}:${at}`, at: new Date(at).toISOString(), title, agency: "BEA", importance: importanceOf(title), url: "https://www.bea.gov/news/schedule", detail: null });
    }
  }
  return out;
}

interface Auction {
  security_type: string;
  security_term: string;
  offering_amt: string;
  auction_date: string;
  reopening: string;
}

export function parseAuctions(rows: Auction[]): CalendarItem[] {
  return rows.map((r) => {
    const amt = Number(r.offering_amt);
    return {
      id: `ust:${r.auction_date}:${r.security_term}:${r.security_type}`,
      // Bill auctions close 11:30 ET, notes/bonds 13:00 ET; shown at 13:00 ET as an approximation of the day.
      at: new Date(`${r.auction_date}T17:00:00Z`).toISOString(),
      title: `${r.security_term} ${r.security_type} auction${r.reopening === "Yes" ? " (reopening)" : ""}`,
      agency: "Treasury" as const,
      importance: /Note|Bond/.test(r.security_type) && /(10|30)-Year/.test(r.security_term) ? ("medium" as const) : ("low" as const),
      url: "https://www.treasurydirect.gov/auctions/upcoming/",
      detail: Number.isFinite(amt) && amt > 0 ? `$${(amt / 1e9).toFixed(0)}B offered` : null,
    };
  });
}

const g = globalThis as unknown as { __worldviewCalendar?: { at: number; items: CalendarItem[] } };

export async function getEconomicCalendar(): Promise<CalendarItem[]> {
  if (g.__worldviewCalendar && Date.now() - g.__worldviewCalendar.at < 6 * 3_600_000) return g.__worldviewCalendar.items;
  const headers = { "User-Agent": userAgent() };
  const get = (u: string) => fetch(u, { headers, signal: AbortSignal.timeout(30_000), cache: "no-store" }).then((r) => (r.ok ? r : Promise.reject(new Error(`HTTP ${r.status}`))));
  const [bls, bea, ust] = await Promise.allSettled([
    get("https://www.bls.gov/schedule/news_release/bls.ics").then((r) => r.text()).then(parseBlsIcs),
    get("https://apps.bea.gov/API/signup/release_dates.json").then((r) => r.json()).then(parseBea),
    get("https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/od/upcoming_auctions?sort=-record_date&page%5Bsize%5D=60")
      .then((r) => r.json())
      .then((j) => parseAuctions(j.data ?? [])),
  ]);
  const items = [bls, bea, ust].flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  // de-duplicate (BEA lists some dates twice; auctions repeat across record dates)
  const unique = [...new Map(items.map((i) => [i.id, i])).values()].sort((a, b) => a.at.localeCompare(b.at));
  if (unique.length) g.__worldviewCalendar = { at: Date.now(), items: unique };
  return unique;
}
