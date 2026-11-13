/**
 * Log hygiene for the long-running server and the launchd jobs:
 *
 *  - installConsoleTimestamps(): prefixes every console line with an ISO timestamp (once per
 *    process), so .data/server.log lines can be placed in time.
 *  - rotateLog(): size-capped copy-truncate rotation (server.log → server.log.1 → .2). The
 *    file is copied then truncated in place rather than renamed, because the writer (launchd
 *    opened it O_APPEND as the process's stdout) keeps its file descriptor: after a truncate
 *    its next write lands at the start of the same, now empty, file.
 *  - rotateKnownLogs(): the server log and the job logs (sentinel, morning briefing, market
 *    close, power watcher). Called at server start and hourly by the server.
 *
 * No "server-only" import so tests can use it directly.
 */
import { copyFileSync, existsSync, renameSync, rmSync, statSync, truncateSync } from "node:fs";
import path from "node:path";

export const LOG_MAX_BYTES = 5 * 1024 * 1024;
export const LOG_KEEP = 2;

const g = globalThis as unknown as { __worldviewConsoleTs?: boolean };

export function timestampArgs(args: unknown[], now = new Date()): unknown[] {
  const ts = now.toISOString();
  // Keep printf-style format strings working: prefix the first string argument.
  if (typeof args[0] === "string") return [`${ts} ${args[0]}`, ...args.slice(1)];
  return [ts, ...args];
}

export function installConsoleTimestamps() {
  if (g.__worldviewConsoleTs) return;
  g.__worldviewConsoleTs = true;
  for (const level of ["log", "info", "warn", "error", "debug"] as const) {
    const orig = console[level].bind(console);
    console[level] = (...args: unknown[]) => orig(...timestampArgs(args));
  }
}

/** Rotate `file` when it is larger than `maxBytes`, keeping `keep` old copies. Returns whether it rotated. */
export function rotateLog(file: string, maxBytes = LOG_MAX_BYTES, keep = LOG_KEEP): boolean {
  try {
    if (!existsSync(file) || statSync(file).size <= maxBytes) return false;
    if (keep < 1) {
      truncateSync(file, 0);
      return true;
    }
    // String.concat, not a template/path.join: Turbopack's file tracer would otherwise read
    // `<file>.<n>` as a pattern over the whole project.
    const nth = (i: number) => file.concat(".", String(i));
    rmSync(nth(keep), { force: true });
    for (let i = keep - 1; i >= 1; i--) if (existsSync(nth(i))) renameSync(nth(i), nth(i + 1));
    copyFileSync(file, nth(1));
    truncateSync(file, 0);
    return true;
  } catch {
    return false;
  }
}

export function knownLogs(dataDir: string): string[] {
  const d = path.resolve(dataDir);
  return [
    path.join(d, "server.log"),
    path.join(d, "sentinel.log"),
    path.join(d, "power.log"),
    path.join(d, "app.log"),
    path.join(d, "briefings", "morning.log"),
    path.join(d, "briefings", "market-close.log"),
  ];
}

export function rotateKnownLogs(dataDir: string, maxBytes = LOG_MAX_BYTES, keep = LOG_KEEP): string[] {
  return knownLogs(dataDir).filter((f) => rotateLog(f, maxBytes, keep));
}
