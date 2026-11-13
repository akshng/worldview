/**
 * Process-wide server context: repository, ingestion runner, scheduler and
 * source health. Stored on globalThis so Next.js dev HMR and separate route
 * bundles share one instance.
 *
 * Sleep-aware scheduling (laptops sleep; Node timers stop while the wall clock runs on):
 *  - a 30 s heartbeat and every source timer check how late they fire; a jump of more than
 *    2 min means the machine slept;
 *  - a failed run that spanned a sleep (a wake was seen after it started, or its wall time is
 *    far beyond its timeout) is discarded: not an ERROR run, not a failure for backoff;
 *  - after a wake, overdue timers don't all fire at once against a network that is still
 *    coming up: a quick connectivity probe runs first (every 15 s, up to 5 min), then the
 *    overdue sources are caught up staggered 2 s apart;
 *  - every run has a wall-time cap (timeout + 60 s) so one stuck connector can't hold its
 *    source "RUNNING" forever;
 *  - a 429/503 Retry-After from the upstream is honoured as a minimum delay.
 */
import "server-only";
import { readFileSync, renameSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { env } from "@/lib/env";
import { createRepository } from "@/lib/db";
import type { EventRepository, IngestionRun } from "@/lib/db/types";
import { CONNECTORS, getConnector } from "@/data-sources/registry";
import { SourceHttpError, type DataSourceConnector } from "@/data-sources/types";
import { userAgent } from "@/lib/env";
import { ingestCandidates } from "@/lib/ingestion/pipeline";
import { recompute } from "@/lib/events/build";
import { publish } from "@/lib/realtime/bus";
import {
  STATS_KEEP_MS,
  analyzeSource,
  emptyStats,
  failureExplainedBySleep,
  isLate,
  nextRunDelay,
  recordStats,
  wallCapMs,
  type SourceAnomaly,
  type SourceStats,
} from "./source-health";

export type SourceHealthStatus = "ONLINE" | "ERROR" | "DEGRADED" | "PENDING" | "DISABLED" | "RUNNING";
export type { SourceAnomaly } from "./source-health";

export interface SourceHealth {
  id: string;
  name: string;
  description: string;
  homepage: string;
  attribution: string;
  categories: string[];
  status: SourceHealthStatus;
  disabledReason: string | null;
  refreshIntervalMs: number;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  nextRunAt: string | null;
  lastRun: IngestionRun | null;
  consecutiveFailures: number;
  /** Last successful run that received more than 0 records */
  lastNonEmptyAt: string | null;
  /** Events created + updated by this source in the last 24 h */
  records24h: number;
  /** empty-streak: ≥3 successful empty runs for a source that normally returns data; volume-drop: last 24 h < 20 % of its 7-day daily median; failing: ≥3 consecutive failures not explained by sleep */
  anomaly: SourceAnomaly;
  anomalyNote: string | null;
}

interface SourceState {
  running: boolean;
  timer: NodeJS.Timeout | null;
  nextRunAt: number | null;
  consecutiveFailures: number;
  lastSuccessAt: number | null;
  lastAttemptAt: number | null;
  lastRun: IngestionRun | null;
  /** Earliest next run allowed by an upstream Retry-After (ms epoch) */
  retryAfterUntil?: number | null;
}

interface Ctx {
  /** Created lazily (embedded Postgres needs async startup) and initialised once. */
  repo: Promise<EventRepository>;
  mode: "live" | "demo";
  started: boolean;
  startedAt: number;
  states: Map<string, SourceState>;
  maintenanceTimer: NodeJS.Timeout | null;
  /** Wall-clock time the last sleep → wake was detected */
  lastWakeAt: number | null;
  wakeHandling: Promise<void> | null;
  stats: Map<string, SourceStats> | null;
  statsTimer: NodeJS.Timeout | null;
}

const g = globalThis as unknown as { __worldviewCtx?: Ctx };

function ctx(): Ctx {
  if (g.__worldviewCtx) return g.__worldviewCtx;
  const e = env();
  // Separate stores keep demo data from ever mixing with live data.
  const repo = createRepository({ databaseUrl: e.DATABASE_URL, dataDir: e.DATA_DIR, mode: e.WORLDVIEW_DATA_MODE }).then(async (r) => {
    await r.init();
    console.info(`[worldview] repository: ${r.kind}`);
    return r;
  });
  repo.catch((err) => console.error("[worldview] repository failed to start:", err));
  g.__worldviewCtx = {
    repo,
    mode: e.WORLDVIEW_DATA_MODE,
    started: false,
    startedAt: Date.now(),
    states: new Map(),
    maintenanceTimer: null,
    lastWakeAt: null,
    wakeHandling: null,
    stats: null,
    statsTimer: null,
  };
  return g.__worldviewCtx;
}

/** The repository without starting scheduled ingestion (for one-shot scripts). */
export async function openRepo(): Promise<EventRepository> {
  return ctx().repo;
}

export async function getRepository(): Promise<EventRepository> {
  const repo = await openRepo();
  ensureStarted();
  return repo;
}

export function dataMode(): "live" | "demo" {
  return ctx().mode;
}

/** When this server process started, and the last detected wake from sleep. */
export function serverInfo(): { startedAt: number; lastWakeAt: number | null } {
  const c = ctx();
  return { startedAt: c.startedAt, lastWakeAt: c.lastWakeAt };
}

export function activeConnectors(): DataSourceConnector<unknown>[] {
  const mode = ctx().mode;
  return CONNECTORS.filter((c) => c.mode === mode);
}

function stateFor(id: string): SourceState {
  const c = ctx();
  let s = c.states.get(id);
  if (!s) {
    s = { running: false, timer: null, nextRunAt: null, consecutiveFailures: 0, lastSuccessAt: null, lastAttemptAt: null, lastRun: null, retryAfterUntil: null };
    c.states.set(id, s);
  }
  return s;
}

function configurationProblem(conn: DataSourceConnector<unknown>): string | null {
  return conn.checkConfiguration?.(process.env as Record<string, string | undefined>) ?? null;
}

const mergeWithinSource = () => new Set(CONNECTORS.filter((c) => c.mergeWithinSource).map((c) => c.id));

// ─── Volume stats (DATA_DIR/source-stats.json) ───────────────────────────────

const statsFile = () => path.resolve(process.cwd(), env().DATA_DIR, `source-stats-${ctx().mode}.json`);

function stats(): Map<string, SourceStats> {
  const c = ctx();
  if (c.stats) return c.stats;
  c.stats = new Map();
  try {
    const raw = JSON.parse(readFileSync(statsFile(), "utf8")) as Record<string, SourceStats>;
    const cutoff = Date.now() - STATS_KEEP_MS;
    for (const [id, s] of Object.entries(raw)) {
      if (s && Array.isArray(s.buckets)) c.stats.set(id, { ...s, buckets: s.buckets.filter((b) => b.h >= cutoff) });
    }
  } catch {
    /* first run */
  }
  return c.stats;
}

function saveStatsSync() {
  const c = ctx();
  if (c.statsTimer) clearTimeout(c.statsTimer);
  c.statsTimer = null;
  if (!c.stats) return;
  try {
    const file = statsFile();
    mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(Object.fromEntries(c.stats)));
    renameSync(tmp, file);
  } catch (err) {
    console.warn("[worldview] source stats save failed:", err instanceof Error ? err.message : err);
  }
}

function scheduleStatsSave() {
  const c = ctx();
  if (c.statsTimer) return;
  c.statsTimer = setTimeout(saveStatsSync, 60_000);
  c.statsTimer.unref?.();
}

function noteSuccess(id: string, run: IngestionRun) {
  const all = stats();
  const now = Date.now();
  all.set(id, recordStats(all.get(id) ?? emptyStats(now), run, now));
  scheduleStatsSave();
}

// ─── Runs ─────────────────────────────────────────────────────────────────────

/** Runs whose failure was discarded because the machine slept during them. */
const discarded = new WeakSet<IngestionRun>();

/** Run one connector end-to-end and record an ingestion run. Never throws. */
export async function runConnector(id: string): Promise<IngestionRun> {
  const conn = getConnector(id);
  const c = ctx();
  const repo = await openRepo();
  const state = stateFor(id);
  const startedAt = Date.now();
  const run: IngestionRun = {
    id: `run_${startedAt.toString(36)}_${id}`,
    dataSourceId: id,
    startedAt: new Date(startedAt).toISOString(),
    completedAt: null,
    success: false,
    recordsReceived: 0,
    recordsCreated: 0,
    recordsUpdated: 0,
    recordsDeduplicated: 0,
    recordsSkipped: 0,
    recordsInvalid: 0,
    errors: [],
    durationMs: null,
  };
  const finish = async () => {
    run.completedAt = new Date().toISOString();
    run.durationMs = Date.now() - startedAt;
    state.lastRun = run;
    state.running = false;
    await repo.recordRun(run);
    publish({ type: "sources.changed", dataSourceId: id });
    return run;
  };

  if (!conn) {
    run.errors.push(`Unknown data source "${id}"`);
    return finish();
  }
  if (conn.mode !== c.mode) {
    run.errors.push(`Source "${id}" is not active in ${c.mode} mode`);
    return finish();
  }
  const problem = configurationProblem(conn);
  if (problem) {
    run.errors.push(problem);
    return finish();
  }
  if (state.running) {
    run.errors.push("A run for this source is already in progress");
    return run;
  }

  state.running = true;
  state.lastAttemptAt = startedAt;
  publish({ type: "sources.changed", dataSourceId: id });
  const timeoutMs = conn.timeoutMs ?? 45_000;
  const cap = new AbortController();
  let capTimer: NodeJS.Timeout | null = null;
  try {
    const work = (async () => {
      const raw = await conn.fetch({
        signal: AbortSignal.any([AbortSignal.timeout(timeoutMs), cap.signal]),
        lastSuccessAt: state.lastSuccessAt,
        now: startedAt,
        userAgent: userAgent(),
        env: process.env as Record<string, string | undefined>,
      });
      const parsed = conn.parse(raw, { now: Date.now(), retrievedAt: new Date().toISOString() });
      if (cap.signal.aborted) throw cap.signal.reason;
      return { parsed, result: await ingestCandidates(repo, parsed.candidates, { mergeWithinSource: mergeWithinSource() }) };
    })();
    work.catch(() => {}); // the cap may win the race; don't leave a rejection unhandled
    const capped = new Promise<never>((_, reject) => {
      capTimer = setTimeout(() => {
        const err = new Error(`Run exceeded its wall-time cap (${Math.round(wallCapMs(timeoutMs) / 1000)} s)`);
        cap.abort(err);
        reject(err);
      }, wallCapMs(timeoutMs));
      capTimer.unref?.();
    });
    const { parsed, result } = await Promise.race([work, capped]);
    run.recordsReceived = parsed.candidates.length + parsed.skipped;
    run.recordsSkipped = parsed.skipped;
    run.recordsCreated = result.created;
    run.recordsUpdated = result.updated;
    run.recordsDeduplicated = result.deduplicated;
    run.recordsInvalid = result.invalid;
    run.errors.push(...(parsed.warnings ?? []).slice(0, 5), ...result.errors);
    run.success = true;
    state.consecutiveFailures = 0;
    state.retryAfterUntil = null;
    state.lastSuccessAt = Date.now();
    noteSuccess(id, run);
    if (result.created || result.updated || result.deduplicated) {
      publish({ type: "events.changed", version: repo.version(), dataSourceId: id, created: result.created, updated: result.updated + result.deduplicated });
    }
  } catch (err) {
    const msg = err instanceof Error ? (err.name === "TimeoutError" ? "Request timed out" : err.message) : String(err);
    if (failureExplainedBySleep(startedAt, Date.now(), timeoutMs, c.lastWakeAt)) {
      // The machine slept during this run: not the source's fault. Don't record an ERROR run
      // or count it toward backoff; the post-wake catch-up sweep runs it again.
      console.info(`[ingest:${id}] failure discarded (the computer slept during the run): ${msg}`);
      state.running = false;
      discarded.add(run);
      publish({ type: "sources.changed", dataSourceId: id });
      return run;
    }
    run.errors.push(msg.slice(0, 500));
    state.consecutiveFailures++;
    if (err instanceof SourceHttpError && err.retryAfterMs) state.retryAfterUntil = Date.now() + err.retryAfterMs;
    console.warn(`[ingest:${id}] failed: ${msg}`);
  } finally {
    if (capTimer) clearTimeout(capTimer);
  }
  return finish();
}

// ─── Scheduling ───────────────────────────────────────────────────────────────

function schedule(conn: DataSourceConnector<unknown>, delayMs: number) {
  const state = stateFor(conn.id);
  if (state.timer) clearTimeout(state.timer);
  const due = Date.now() + delayMs;
  state.nextRunAt = due;
  state.timer = setTimeout(async () => {
    state.timer = null;
    if (isLate(due, Date.now())) {
      // Fired long after it was due: the machine slept. Leave it overdue for the wake sweep.
      onWake();
      return;
    }
    const run = await runConnector(conn.id);
    if (discarded.has(run)) {
      state.nextRunAt = Date.now(); // overdue → picked up by the catch-up sweep
      onWake();
      return;
    }
    const retryAfter = state.retryAfterUntil ? state.retryAfterUntil - Date.now() : null;
    schedule(conn, nextRunDelay(conn.refreshIntervalMs, state.consecutiveFailures, retryAfter && retryAfter > 0 ? retryAfter : null));
  }, delayMs);
  state.timer.unref?.();
}

const PROBE_URL = process.env.WORLDVIEW_PROBE_URL || "https://www.cloudflare.com/cdn-cgi/trace";
const PROBE_EVERY_MS = 15_000;
const PROBE_MAX_TRIES = 20; // 5 min
const SWEEP_STAGGER_MS = 2_000;

/** Any HTTP answer means the network is back. */
async function online(): Promise<boolean> {
  try {
    const res = await fetch(PROBE_URL, { method: "HEAD", headers: { "User-Agent": userAgent() }, signal: AbortSignal.timeout(5_000), cache: "no-store" });
    await res.body?.cancel().catch(() => {});
    return true;
  } catch {
    return false;
  }
}

/** Sleep → wake: probe connectivity, then run overdue sources staggered. Single-flight. */
function onWake() {
  const c = ctx();
  c.lastWakeAt = Date.now();
  if (c.wakeHandling) return;
  console.info("[worldview] wake from sleep detected — checking the network before catching up");
  c.wakeHandling = (async () => {
    let ok = false;
    for (let i = 0; i < PROBE_MAX_TRIES && !(ok = await online()); i++) await new Promise((r) => setTimeout(r, PROBE_EVERY_MS).unref?.());
    if (!ok) console.warn("[worldview] still offline 5 min after wake — catching up anyway");
    const now = Date.now();
    const overdue = activeConnectors()
      .filter((conn) => {
        const s = stateFor(conn.id);
        return !configurationProblem(conn) && !s.running && s.nextRunAt !== null && s.nextRunAt <= now + 1_000;
      })
      .sort((a, b) => (stateFor(a.id).nextRunAt ?? 0) - (stateFor(b.id).nextRunAt ?? 0));
    overdue.forEach((conn, i) => schedule(conn, 1_000 + i * SWEEP_STAGGER_MS));
    console.info(`[worldview] catch-up: ${overdue.length} overdue sources over ${Math.round((overdue.length * SWEEP_STAGGER_MS) / 1000)} s`);
  })().finally(() => {
    c.wakeHandling = null;
  });
}

const HEARTBEAT_MS = 30_000;
function startHeartbeat() {
  let last = Date.now();
  const t = setInterval(() => {
    const now = Date.now();
    if (isLate(last + HEARTBEAT_MS, now)) onWake();
    last = now;
  }, HEARTBEAT_MS);
  t.unref?.();
}

/** Re-score (recency decays) and prune old events. */
async function maintenance() {
  const repo = await openRepo();
  const now = Date.now();
  const removed = await repo.prune(now - env().RETENTION_DAYS * 86_400_000);
  const all = await repo.scan({});
  const changed = [];
  for (const e of all) {
    const r = recompute(e, now);
    if (r.importanceScore !== e.importanceScore || r.status !== e.status) changed.push(r);
  }
  await repo.saveMany(changed);
  if (removed || changed.length) publish({ type: "events.changed", version: repo.version(), dataSourceId: "maintenance", created: 0, updated: changed.length });
}

/** Start the per-source schedulers once per process. */
export function ensureStarted() {
  const c = ctx();
  if (c.started) return;
  c.started = true;
  // The battery watcher stops the server with SIGTERM several times a day: save the
  // store first so the last ~30 s of ingested events aren't lost.
  for (const sig of ["SIGTERM", "SIGINT"] as const) {
    process.once(sig, () => {
      saveStatsSync();
      void openRepo().then((r) => (r as { flushSync?: () => void }).flushSync?.()).finally(() => process.exit(0));
    });
  }
  if (!env().INGESTION_ENABLED) {
    console.info("[worldview] ingestion disabled (INGESTION_ENABLED=false)");
    return;
  }
  console.info(`[worldview] starting ingestion in ${c.mode.toUpperCase()} mode`);
  stats();
  startHeartbeat();
  void (async () => {
    const repo = await openRepo();
    const now = Date.now();
    for (const [i, conn] of activeConnectors().entries()) {
      if (configurationProblem(conn)) continue;
      // Respect rate limits across restarts: if the persisted log shows a recent
      // successful run, wait out the remainder of the interval.
      const last = (await repo.listRuns({ dataSourceId: conn.id, limit: 20 })).find((r) => r.success);
      const sinceLast = last?.completedAt ? now - Date.parse(last.completedAt) : Infinity;
      const stagger = 500 + i * 1500;
      schedule(conn, Math.max(stagger, conn.refreshIntervalMs - sinceLast));
    }
  })();
  c.maintenanceTimer = setInterval(() => void maintenance().catch((e) => console.warn("[maintenance]", e)), 5 * 60_000);
  c.maintenanceTimer.unref?.();
  const discord = setInterval(() => void openRepo().then((r) => import("@/lib/notify/discord-server").then((m) => m.discordTick(r))), 2 * 60_000);
  discord.unref?.();
}

export async function getSourceHealth(): Promise<SourceHealth[]> {
  const repo = await openRepo();
  const all = stats();
  const now = Date.now();
  const out: SourceHealth[] = [];
  for (const conn of activeConnectors()) {
    const s = stateFor(conn.id);
    const problem = configurationProblem(conn);
    // Fall back to persisted runs (from before a restart) when no in-process state yet.
    const recent = await repo.listRuns({ dataSourceId: conn.id, limit: 50 });
    const lastRun = s.lastRun ?? recent[0] ?? null;
    const persistedSuccess = recent.find((r) => r.success && r.completedAt)?.completedAt;
    const lastSuccess = s.lastSuccessAt ?? (persistedSuccess ? Date.parse(persistedSuccess) : null);
    const health = analyzeSource({ runs: recent, stats: all.get(conn.id) ?? null, consecutiveFailures: s.consecutiveFailures, refreshIntervalMs: conn.refreshIntervalMs, now });
    let status: SourceHealthStatus;
    if (problem) status = "DISABLED";
    else if (s.running) status = "RUNNING";
    else if (!lastRun) status = "PENDING";
    else if (!lastRun.success) status = "ERROR";
    else if (lastRun.recordsInvalid > 0 || (lastSuccess && now - lastSuccess > conn.refreshIntervalMs * 4) || health.anomaly === "empty-streak") status = "DEGRADED";
    else status = "ONLINE";
    out.push({
      id: conn.id,
      name: conn.name,
      description: conn.description,
      homepage: conn.homepage,
      attribution: conn.attribution,
      categories: conn.categories,
      status,
      disabledReason: problem,
      refreshIntervalMs: conn.refreshIntervalMs,
      lastAttemptAt: s.lastAttemptAt ? new Date(s.lastAttemptAt).toISOString() : (lastRun?.startedAt ?? null),
      lastSuccessAt: lastSuccess ? new Date(lastSuccess).toISOString() : null,
      nextRunAt: s.nextRunAt ? new Date(s.nextRunAt).toISOString() : null,
      lastRun,
      consecutiveFailures: s.consecutiveFailures,
      lastNonEmptyAt: health.lastNonEmptyAt,
      records24h: health.records24h,
      anomaly: problem ? null : health.anomaly,
      anomalyNote: problem ? null : health.anomalyNote,
    });
  }
  return out;
}
