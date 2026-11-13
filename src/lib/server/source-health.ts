/**
 * Pure scheduler / source-health logic used by src/lib/server/context.ts (unit-tested in
 * tests/source-health.test.ts):
 *
 *  - per-source hourly volume stats (records = created + updated, successful runs, runs that
 *    received anything), kept 8 days and persisted to DATA_DIR/source-stats.json — the 20 runs
 *    the repository keeps per source cover only ~1.5 h of a 5-minute source;
 *  - anomaly detection: "failing", "empty-streak", "volume-drop";
 *  - sleep / wake detection helpers and the next-run delay (backoff + Retry-After).
 */
import type { IngestionRun } from "@/lib/db/types";

export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;
export const STATS_KEEP_MS = 8 * DAY;

export type SourceAnomaly = null | "empty-streak" | "volume-drop" | "failing";

export interface HourBucket {
  /** Hour start (ms epoch, UTC-aligned) */
  h: number;
  /** recordsCreated + recordsUpdated */
  records: number;
  /** successful runs */
  runs: number;
  /** successful runs that received at least one record */
  nonEmpty: number;
}

export interface SourceStats {
  firstAt: number;
  lastNonEmptyAt: number | null;
  buckets: HourBucket[];
}

export const emptyStats = (now: number): SourceStats => ({ firstAt: now, lastNonEmptyAt: null, buckets: [] });

/** Add one successful run to the stats (mutates and returns them). */
export function recordStats(stats: SourceStats, run: Pick<IngestionRun, "recordsReceived" | "recordsCreated" | "recordsUpdated">, now: number): SourceStats {
  const h = Math.floor(now / HOUR) * HOUR;
  let b = stats.buckets[stats.buckets.length - 1];
  if (!b || b.h !== h) {
    b = { h, records: 0, runs: 0, nonEmpty: 0 };
    stats.buckets.push(b);
  }
  b.records += run.recordsCreated + run.recordsUpdated;
  b.runs++;
  if (run.recordsReceived > 0) {
    b.nonEmpty++;
    stats.lastNonEmptyAt = now;
  }
  const cutoff = now - STATS_KEEP_MS;
  while (stats.buckets.length && stats.buckets[0].h < cutoff) stats.buckets.shift();
  return stats;
}

function sumWindow(stats: SourceStats, from: number, to: number) {
  let records = 0;
  let runs = 0;
  let nonEmpty = 0;
  for (const b of stats.buckets) {
    if (b.h < from || b.h >= to) continue;
    records += b.records;
    runs += b.runs;
    nonEmpty += b.nonEmpty;
  }
  return { records, runs, nonEmpty };
}

export function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Runs expected per day at this interval (scheduler polls at most hourly-bucket granularity is fine). */
const expectedRunsPerDay = (refreshIntervalMs: number) => Math.max(1, DAY / Math.max(refreshIntervalMs, 60_000));
/** A day counts toward the baseline only if the server ran for a fair share of it. */
const COVERAGE = 0.3;

export interface AnomalyInput {
  /** Persisted runs, newest first */
  runs: IngestionRun[];
  stats: SourceStats | null;
  /** In-process failures (sleep-explained failures are never counted) */
  consecutiveFailures: number;
  refreshIntervalMs: number;
  now: number;
}

export interface AnomalyResult {
  anomaly: SourceAnomaly;
  anomalyNote: string | null;
  records24h: number;
  lastNonEmptyAt: string | null;
}

const leading = (runs: IngestionRun[], pred: (r: IngestionRun) => boolean) => {
  let n = 0;
  while (n < runs.length && pred(runs[n])) n++;
  return n;
};

export function analyzeSource(input: AnomalyInput): AnomalyResult {
  const { runs, stats, refreshIntervalMs, now } = input;
  const done = runs.filter((r) => r.completedAt);

  // ── records24h / lastNonEmptyAt ──
  const persistedNonEmpty = done.find((r) => r.success && r.recordsReceived > 0)?.completedAt ?? null;
  const statsNonEmpty = stats?.lastNonEmptyAt ?? null;
  const lastNonEmptyMs = Math.max(statsNonEmpty ?? -Infinity, persistedNonEmpty ? Date.parse(persistedNonEmpty) : -Infinity);
  const lastNonEmptyAt = Number.isFinite(lastNonEmptyMs) ? new Date(lastNonEmptyMs).toISOString() : null;
  const statsCover24h = stats && stats.firstAt <= now - DAY + HOUR;
  const fromRuns24h = done.filter((r) => r.success && now - Date.parse(r.completedAt!) < DAY).reduce((s, r) => s + r.recordsCreated + r.recordsUpdated, 0);
  const last24 = stats ? sumWindow(stats, now - DAY, now + HOUR) : { records: 0, runs: 0, nonEmpty: 0 };
  // Stats are the better source once they exist; before they span 24 h, take whichever saw more.
  const records24h = stats ? (statsCover24h ? last24.records : Math.max(last24.records, fromRuns24h)) : fromRuns24h;

  const result = (anomaly: SourceAnomaly, anomalyNote: string | null): AnomalyResult => ({ anomaly, anomalyNote, records24h, lastNonEmptyAt });

  // ── failing ──
  const failures = Math.max(input.consecutiveFailures, leading(done, (r) => !r.success));
  if (failures >= 3) {
    const err = done.find((r) => !r.success)?.errors[0];
    return result("failing", `${failures} consecutive failed runs${err ? ` — last error: ${err.slice(0, 160)}` : ""}`);
  }

  // ── empty-streak ──
  const streak = leading(done, (r) => r.success && r.recordsReceived === 0);
  if (streak >= 3) {
    const streakStart = Date.parse(done[streak - 1].startedAt);
    const before = stats ? sumWindow(stats, -Infinity, Math.floor(streakStart / HOUR) * HOUR) : { runs: 0, nonEmpty: 0, records: 0 };
    const older = done.slice(streak).filter((r) => r.success);
    const normally =
      before.runs >= 6 ? before.nonEmpty / before.runs >= 0.8 : older.length >= 3 && older.filter((r) => r.recordsReceived > 0).length / older.length >= 0.8;
    if (normally) {
      const since = lastNonEmptyAt ? ` since ${lastNonEmptyAt}` : "";
      return result("empty-streak", `${streak}${streak >= done.length ? "+" : ""} successful runs in a row returned no records${since} (it normally returns data)`);
    }
  }

  // ── volume-drop ──
  if (stats) {
    const expected = expectedRunsPerDay(refreshIntervalMs);
    const days: number[] = [];
    for (let k = 1; k <= 7; k++) {
      const from = now - (k + 1) * DAY;
      if (from < stats.firstAt - HOUR) break;
      const d = sumWindow(stats, from, now - k * DAY);
      if (d.runs >= expected * COVERAGE) days.push(d.records);
    }
    const base = median(days);
    if (days.length >= 3 && base >= 10 && last24.runs >= expected * COVERAGE && records24h < 0.2 * base) {
      return result("volume-drop", `${records24h} records in the last 24 h vs a median of ${Math.round(base)}/day over the previous ${days.length} days`);
    }
  }
  return result(null, null);
}

// ── Sleep / wake ────────────────────────────────────────────────────────────

/** A timer or heartbeat this late means the machine was asleep (Node timers don't run during sleep). */
export const WAKE_LATENESS_MS = 2 * 60_000;

export function isLate(expectedAt: number, firedAt: number, threshold = WAKE_LATENESS_MS): boolean {
  return firedAt - expectedAt > threshold;
}

/**
 * Whether a failed run is explained by sleep: a wake was detected after it started, or
 * its wall-clock duration is far beyond its own timeout (timers stop during sleep, the
 * wall clock doesn't).
 */
export function failureExplainedBySleep(startedAt: number, endedAt: number, timeoutMs: number, lastWakeAt: number | null): boolean {
  if (lastWakeAt !== null && lastWakeAt >= startedAt) return true;
  return endedAt - startedAt > timeoutMs * 1.5 + 60_000;
}

/** Per-run wall-time cap: a run that ignores its abort signal can't hold the source forever. */
export const wallCapMs = (timeoutMs: number) => timeoutMs + 60_000;

/**
 * Next delay after a run: exponential backoff on repeated failures (capped at 8× the
 * interval / 1 h), and never sooner than the upstream's Retry-After (capped at 6 h).
 */
export function nextRunDelay(refreshIntervalMs: number, consecutiveFailures: number, retryAfterMs: number | null = null): number {
  const backoff = Math.min(2 ** consecutiveFailures, 8);
  const base = Math.min(refreshIntervalMs * backoff, Math.max(refreshIntervalMs, 3_600_000));
  return retryAfterMs ? Math.max(base, Math.min(retryAfterMs, 6 * 3_600_000)) : base;
}
