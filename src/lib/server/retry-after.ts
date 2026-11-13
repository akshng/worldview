/**
 * Parse an HTTP Retry-After header (RFC 9110 §10.2.3): either delay-seconds ("120") or an
 * HTTP-date ("Wed, 21 Oct 2026 07:28:00 GMT"). Returns milliseconds from `now`, clamped to
 * [0, maxMs], or null when absent or unparseable. Pure (unit-tested).
 */
export function parseRetryAfter(value: string | null | undefined, now = Date.now(), maxMs = 24 * 3_600_000): number | null {
  if (value == null) return null;
  const v = value.trim();
  if (!v) return null;
  let ms: number;
  if (/^\d+(\.\d+)?$/.test(v)) ms = Number(v) * 1000;
  else {
    const at = Date.parse(v);
    if (!Number.isFinite(at)) return null;
    ms = at - now;
  }
  return Math.min(Math.max(0, Math.round(ms)), maxMs);
}
