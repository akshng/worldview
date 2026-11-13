/**
 * The one SEC fair-access gate. Every request to *.sec.gov (data.sec.gov, www.sec.gov,
 * efts.sec.gov) from this process goes through `secGateFetch`:
 *
 *  - at most 8 requests per second in total (SEC's limit is 10), spaced 125 ms apart;
 *  - 429 / 503 answers are retried (twice) after their Retry-After (or 2 s, 4 s), and the
 *    wait applies to every later SEC request too, not just the one that was refused;
 *  - a 403 "Request Rate Threshold Exceeded" (SEC's 10-minute block) pauses all SEC
 *    traffic for 10 minutes; while paused longer than a minute, requests fail fast with
 *    SecRateLimitedError (carrying retryAfterMs) instead of queueing;
 *  - the caller's honest User-Agent (userAgent(), with WORLDVIEW_CONTACT) is required.
 *
 * Used by httpGet (the SEC connectors), secFetch (13F, Form 4), company profiles, 10-K
 * analysis, IPO and earnings-release searches. State lives on globalThis so all route
 * bundles share it. It is per process: one-shot scripts (sentinel, close job) running
 * beside the server have their own gate; they make only a handful of SEC requests.
 * No "server-only" import: data-sources/types.ts (unit-tested) depends on it.
 */
import { parseRetryAfter } from "@/lib/server/retry-after";

export const SEC_MIN_GAP_MS = 125;
const RETRIES = 2;
/** Longest wait a request will sit out in the queue; beyond that it fails fast. */
const MAX_QUEUE_WAIT_MS = 60_000;
const THRESHOLD_BLOCK_MS = 10 * 60_000;

export class SecRateLimitedError extends Error {
  constructor(readonly retryAfterMs: number) {
    super(`SEC rate limited — retry in ${Math.ceil(retryAfterMs / 1000)} s`);
    this.name = "SecRateLimitedError";
  }
}

interface GateState {
  nextSlot: number;
  pausedUntil: number;
}
const g = globalThis as unknown as { __worldviewSecGate?: GateState };
const gate = (): GateState => (g.__worldviewSecGate ??= { nextSlot: 0, pausedUntil: 0 });

/** For tests. */
export function _resetSecGate() {
  g.__worldviewSecGate = { nextSlot: 0, pausedUntil: 0 };
}

export function isSecUrl(url: string): boolean {
  try {
    const h = new URL(url).hostname.toLowerCase();
    return h === "sec.gov" || h.endsWith(".sec.gov");
  } catch {
    return false;
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(signal!.reason);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** Reserve the next send slot (respecting any pause); returns how long to wait. */
export function reserveSlot(now = Date.now()): number {
  const st = gate();
  const pause = st.pausedUntil - now;
  if (pause > MAX_QUEUE_WAIT_MS) throw new SecRateLimitedError(pause);
  const slot = Math.max(now, st.nextSlot, st.pausedUntil);
  st.nextSlot = slot + SEC_MIN_GAP_MS;
  return slot - now;
}

/** Pause every SEC request for `ms` (never shortens an existing pause). */
export function pauseSec(ms: number, now = Date.now()) {
  const st = gate();
  st.pausedUntil = Math.max(st.pausedUntil, now + ms);
}

export interface SecFetchInit {
  headers: Record<string, string>;
  signal?: AbortSignal;
  /** Defaults to globalThis.fetch (injectable for tests). */
  fetchImpl?: typeof fetch;
}

/**
 * Throttled fetch for *.sec.gov. Returns the final Response (callers check `ok`); throws
 * SecRateLimitedError when SEC traffic is paused for longer than a minute.
 */
export async function secGateFetch(url: string, init: SecFetchInit): Promise<Response> {
  if (!init.headers["User-Agent"]) throw new Error("SEC requests need the app's User-Agent");
  const doFetch = init.fetchImpl ?? fetch;
  for (let attempt = 0; ; attempt++) {
    await sleep(reserveSlot(), init.signal);
    const res = await doFetch(url, { headers: init.headers, signal: init.signal, cache: "no-store" });
    if (res.status === 429 || res.status === 503) {
      const wait = parseRetryAfter(res.headers.get("retry-after")) ?? 2000 * (attempt + 1);
      pauseSec(wait);
      if (attempt < RETRIES && wait <= MAX_QUEUE_WAIT_MS) {
        await res.body?.cancel().catch(() => {});
        continue;
      }
      return res;
    }
    if (res.status === 403) {
      const body = await res
        .clone()
        .text()
        .catch(() => "");
      if (/rate threshold/i.test(body)) pauseSec(THRESHOLD_BLOCK_MS);
    }
    return res;
  }
}
