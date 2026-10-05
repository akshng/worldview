/**
 * Process-wide server context: repository, ingestion runner, scheduler and
 * source health. Stored on globalThis so Next.js dev HMR and separate route
 * bundles share one instance.
 */
import "server-only";
import { env } from "@/lib/env";
import { createRepository } from "@/lib/db";
import type { EventRepository, IngestionRun } from "@/lib/db/types";
import { CONNECTORS, getConnector } from "@/data-sources/registry";
import type { DataSourceConnector } from "@/data-sources/types";
import { userAgent } from "@/lib/env";
import { ingestCandidates } from "@/lib/ingestion/pipeline";
import { recompute } from "@/lib/events/build";
import { publish } from "@/lib/realtime/bus";

export type SourceHealthStatus = "ONLINE" | "ERROR" | "DEGRADED" | "PENDING" | "DISABLED" | "RUNNING";

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
}

interface SourceState {
  running: boolean;
  timer: NodeJS.Timeout | null;
  nextRunAt: number | null;
  consecutiveFailures: number;
  lastSuccessAt: number | null;
  lastAttemptAt: number | null;
  lastRun: IngestionRun | null;
}

interface Ctx {
  /** Created lazily (embedded Postgres needs async startup) and initialised once. */
  repo: Promise<EventRepository>;
  mode: "live" | "demo";
  started: boolean;
  states: Map<string, SourceState>;
  maintenanceTimer: NodeJS.Timeout | null;
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
    states: new Map(),
    maintenanceTimer: null,
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

export function activeConnectors(): DataSourceConnector<unknown>[] {
  const mode = ctx().mode;
  return CONNECTORS.filter((c) => c.mode === mode);
}

function stateFor(id: string): SourceState {
  const c = ctx();
  let s = c.states.get(id);
  if (!s) {
    s = { running: false, timer: null, nextRunAt: null, consecutiveFailures: 0, lastSuccessAt: null, lastAttemptAt: null, lastRun: null };
    c.states.set(id, s);
  }
  return s;
}

function configurationProblem(conn: DataSourceConnector<unknown>): string | null {
  return conn.checkConfiguration?.(process.env as Record<string, string | undefined>) ?? null;
}

const mergeWithinSource = () => new Set(CONNECTORS.filter((c) => c.mergeWithinSource).map((c) => c.id));

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
  try {
    const raw = await conn.fetch({
      signal: AbortSignal.timeout(conn.timeoutMs ?? 45_000),
      lastSuccessAt: state.lastSuccessAt,
      now: startedAt,
      userAgent: userAgent(),
      env: process.env as Record<string, string | undefined>,
    });
    const parsed = conn.parse(raw, { now: Date.now(), retrievedAt: new Date().toISOString() });
    const result = await ingestCandidates(repo, parsed.candidates, { mergeWithinSource: mergeWithinSource() });
    run.recordsReceived = parsed.candidates.length + parsed.skipped;
    run.recordsSkipped = parsed.skipped;
    run.recordsCreated = result.created;
    run.recordsUpdated = result.updated;
    run.recordsDeduplicated = result.deduplicated;
    run.recordsInvalid = result.invalid;
    run.errors.push(...(parsed.warnings ?? []).slice(0, 5), ...result.errors);
    run.success = true;
    state.consecutiveFailures = 0;
    state.lastSuccessAt = Date.now();
    if (result.created || result.updated || result.deduplicated) {
      publish({ type: "events.changed", version: repo.version(), dataSourceId: id, created: result.created, updated: result.updated + result.deduplicated });
    }
  } catch (err) {
    const msg = err instanceof Error ? (err.name === "TimeoutError" ? "Request timed out" : err.message) : String(err);
    run.errors.push(msg.slice(0, 500));
    state.consecutiveFailures++;
    console.warn(`[ingest:${id}] failed: ${msg}`);
  }
  return finish();
}

function schedule(conn: DataSourceConnector<unknown>, delayMs: number) {
  const state = stateFor(conn.id);
  if (state.timer) clearTimeout(state.timer);
  state.nextRunAt = Date.now() + delayMs;
  state.timer = setTimeout(async () => {
    state.timer = null;
    await runConnector(conn.id);
    // Exponential backoff on repeated failures (capped at 8× the interval / 1 h).
    const backoff = Math.min(2 ** state.consecutiveFailures, 8);
    schedule(conn, Math.min(conn.refreshIntervalMs * backoff, Math.max(conn.refreshIntervalMs, 3_600_000)));
  }, delayMs);
  state.timer.unref?.();
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
  if (!env().INGESTION_ENABLED) {
    console.info("[worldview] ingestion disabled (INGESTION_ENABLED=false)");
    return;
  }
  console.info(`[worldview] starting ingestion in ${c.mode.toUpperCase()} mode`);
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
}

export async function getSourceHealth(): Promise<SourceHealth[]> {
  const c = ctx();
  const repo = await openRepo();
  const out: SourceHealth[] = [];
  for (const conn of activeConnectors()) {
    const s = stateFor(conn.id);
    const problem = configurationProblem(conn);
    // Fall back to persisted runs (from before a restart) when no in-process state yet.
    const recent = await repo.listRuns({ dataSourceId: conn.id, limit: 50 });
    const lastRun = s.lastRun ?? recent[0] ?? null;
    const persistedSuccess = recent.find((r) => r.success && r.completedAt)?.completedAt;
    const lastSuccess = s.lastSuccessAt ?? (persistedSuccess ? Date.parse(persistedSuccess) : null);
    let status: SourceHealthStatus;
    if (problem) status = "DISABLED";
    else if (s.running) status = "RUNNING";
    else if (!lastRun) status = "PENDING";
    else if (!lastRun.success) status = "ERROR";
    else if (lastRun.recordsInvalid > 0 || (lastSuccess && Date.now() - lastSuccess > conn.refreshIntervalMs * 4)) status = "DEGRADED";
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
    });
  }
  return out;
}
