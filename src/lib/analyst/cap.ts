/**
 * Size-capping for tool output. The model's context is small (12k tokens on the
 * local model), so every tool result is shrunk deterministically to a character
 * budget: long strings are cut, arrays are shortened from the end (with an
 * "…N more" marker), numbers are rounded. Pure and tested.
 */

const round = (n: number) => (Number.isInteger(n) ? n : Math.abs(n) >= 1000 ? Math.round(n) : Math.abs(n) >= 1 ? Math.round(n * 100) / 100 : Math.round(n * 10_000) / 10_000);

function shrink(value: unknown, maxArray: number, maxString: number, depth = 0): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? round(value) : null;
  if (typeof value === "string") return value.length > maxString ? `${value.slice(0, maxString - 1)}…` : value;
  if (typeof value !== "object") return value;
  if (depth > 6) return "…";
  if (Array.isArray(value)) {
    const kept = value.slice(0, maxArray).map((v) => shrink(v, maxArray, maxString, depth + 1));
    if (value.length > maxArray) kept.push(`…${value.length - maxArray} more`);
    return kept;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (v === undefined || v === null || (Array.isArray(v) && v.length === 0)) continue;
    out[k] = shrink(v, maxArray, maxString, depth + 1);
  }
  return out;
}

/** Compact JSON no longer than `maxChars` (best effort: arrays and strings shrink until it fits). */
export function capJson(value: unknown, maxChars: number): string {
  let maxArray = 40;
  let maxString = 400;
  for (let i = 0; i < 12; i++) {
    const s = JSON.stringify(shrink(value, maxArray, maxString));
    if (s.length <= maxChars) return s;
    maxArray = Math.max(1, Math.floor(maxArray * 0.6));
    maxString = Math.max(40, Math.floor(maxString * 0.7));
  }
  const s = JSON.stringify(shrink(value, 1, 40));
  return s.length <= maxChars ? s : `${s.slice(0, maxChars - 12)}…[truncated]`;
}

/** Downsample a series to at most `n` points, always keeping the first and last. */
export function downsample<T>(points: T[], n: number): T[] {
  if (points.length <= n || n < 2) return points;
  const out: T[] = [];
  const step = (points.length - 1) / (n - 1);
  for (let i = 0; i < n; i++) out.push(points[Math.round(i * step)]);
  return out;
}
