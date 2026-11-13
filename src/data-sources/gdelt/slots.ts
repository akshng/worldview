/**
 * GDELT 2.0 publishes one file per 15-minute slot. lastupdate.txt sometimes lists
 * the newest slot a little before the file is downloadable, so each run fetches the
 * new slots and, when none of them is available yet, falls back to the previous
 * slots instead of failing (re-ingesting a slot is harmless: records upsert).
 */
import { httpGet, SourceHttpError, type FetchContext } from "../types";

export const SLOT_MS = 15 * 60_000;
/** Earlier slots tried when none of the new ones is published yet. */
export const FALLBACK_SLOTS = 2;

export const stamp = (t: number) => new Date(t).toISOString().replace(/[-:T]/g, "").slice(0, 14);
export const parseStamp = (s: string) => Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +s.slice(8, 10), +s.slice(10, 12), +s.slice(12, 14));

/** Slot times to fetch: the latest back to the last success (bounded), then fallbacks. */
export function slotPlan(latestMs: number, lastSuccessAt: number | null, opts: { backfill: number; max: number }): { primary: number[]; fallback: number[] } {
  const since = lastSuccessAt ? lastSuccessAt - SLOT_MS : latestMs - opts.backfill * SLOT_MS;
  const primary: number[] = [];
  for (let t = latestMs, n = 0; t > since && n < opts.max; t -= SLOT_MS, n++) primary.push(t);
  if (!primary.length) primary.push(latestMs);
  const oldest = primary[primary.length - 1];
  const fallback = Array.from({ length: FALLBACK_SLOTS }, (_, i) => oldest - (i + 1) * SLOT_MS);
  return { primary, fallback };
}

/**
 * Download slot files. Missing (404) slots are skipped; if no new slot is available
 * the previous slot is used. Throws only when the fallbacks are missing too.
 */
export async function fetchSlots<T>(
  plan: { primary: number[]; fallback: number[] },
  urlFor: (t: number) => string,
  read: (buf: Uint8Array, url: string) => T | null,
  ctx: FetchContext,
  label: string,
): Promise<T[]> {
  const out: T[] = [];
  const tryAll = async (slots: number[], stopAtFirst: boolean) => {
    for (const t of slots) {
      const url = urlFor(t);
      try {
        const buf = new Uint8Array(await (await httpGet(url, ctx, { accept: "application/zip" })).arrayBuffer());
        const file = read(buf, url);
        if (file) out.push(file);
        if (stopAtFirst && file) return;
      } catch (err) {
        if (!(err instanceof SourceHttpError && err.status === 404)) throw err;
      }
    }
  };
  await tryAll(plan.primary, false);
  if (!out.length) await tryAll(plan.fallback, true);
  if (!out.length) throw new Error(`No ${label} files available (latest and previous slots missing)`);
  return out;
}
