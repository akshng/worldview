import { httpGet, type FetchContext } from "../types";
import type { SpcRaw } from "./types";

const BASE = "https://www.spc.noaa.gov/climo/reports";

export function reportDay(ms: number): string {
  // A report day starts at 12:00 UTC.
  return new Date(ms - 12 * 3_600_000).toISOString().slice(2, 10).replace(/-/g, "");
}

/** The current report day plus the two before it. */
export async function fetchSpc(ctx: FetchContext): Promise<SpcRaw> {
  const today = reportDay(ctx.now);
  const days = [0, 1, 2].map((i) => reportDay(ctx.now - i * 86_400_000));
  const out: SpcRaw = { days: [] };
  for (const day of days) {
    const url = day === today ? `${BASE}/today_filtered.csv` : `${BASE}/${day}_rpts_filtered.csv`;
    try {
      out.days.push({ day, csv: await (await httpGet(url, ctx, { accept: "text/csv, text/plain" })).text() });
    } catch (err) {
      if (day === today) throw err; // older days are best-effort
    }
  }
  return out;
}
