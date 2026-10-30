/**
 * Live check of every data source: runs each live connector's fetch + parse once and prints
 * candidates / skipped / errors. Nothing is written to the database.
 *
 *   npm run sources:check                  # all live connectors
 *   npm run sources:check -- usgs fema-declarations   # only these ids
 *
 * Exits 1 if any connector failed or returned no candidates and no skipped records (likely a
 * dead or changed feed).
 */
import { existsSync } from "node:fs";
import { CONNECTORS } from "@/data-sources/registry";
import { userAgent } from "@/lib/env";

// Keys (NASA_FIRMS_MAP_KEY, …) and WORLDVIEW_CONTACT for the User-Agent; env() is read lazily.
for (const f of [".env.local", ".env"]) {
  if (existsSync(f)) process.loadEnvFile(f);
}

const only = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const list = CONNECTORS.filter((c) => c.mode === "live" && (!only.length || only.includes(c.id)));
const unknown = only.filter((id) => !CONNECTORS.some((c) => c.id === id));
if (unknown.length) console.warn(`Unknown ids: ${unknown.join(", ")}`);

type Row = { id: string; ok: boolean; candidates: number; skipped: number; ms: number; note: string };

async function check(c: (typeof CONNECTORS)[number]): Promise<Row> {
  const started = Date.now();
  const config = c.checkConfiguration?.(process.env);
  if (config) return { id: c.id, ok: true, candidates: 0, skipped: 0, ms: 0, note: `not configured: ${config}` };
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), c.timeoutMs ?? 30_000);
  try {
    const now = Date.now();
    const raw = await c.fetch({ signal: ac.signal, lastSuccessAt: null, now, userAgent: userAgent(), env: process.env });
    const r = c.parse(raw, { now, retrievedAt: new Date(now).toISOString() });
    const empty = r.candidates.length === 0 && r.skipped === 0;
    return { id: c.id, ok: !empty, candidates: r.candidates.length, skipped: r.skipped, ms: Date.now() - started, note: empty ? "feed returned nothing" : (r.warnings ?? []).join("; ") };
  } catch (e) {
    return { id: c.id, ok: false, candidates: 0, skipped: 0, ms: Date.now() - started, note: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(timer);
  }
}

const rows: Row[] = [];
// A few at a time, to stay polite to shared hosts (SEC, NOAA, …).
for (let i = 0; i < list.length; i += 6) rows.push(...(await Promise.all(list.slice(i, i + 6).map(check))));

const pad = (s: string | number, n: number) => String(s).padEnd(n);
console.log(`${pad("source", 22)}${pad("status", 8)}${pad("events", 8)}${pad("skipped", 9)}${pad("ms", 7)}note`);
for (const r of rows) console.log(`${pad(r.id, 22)}${pad(r.ok ? "ok" : "FAIL", 8)}${pad(r.candidates, 8)}${pad(r.skipped, 9)}${pad(r.ms, 7)}${r.note.slice(0, 160)}`);
const failed = rows.filter((r) => !r.ok);
console.log(`\n${rows.length - failed.length}/${rows.length} sources ok${failed.length ? `; failing: ${failed.map((r) => r.id).join(", ")}` : ""}`);
process.exit(failed.length ? 1 : 0);
