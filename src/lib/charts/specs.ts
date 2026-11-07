/** Chart definitions for the Charts page (saved in the UI store) and pure helpers. */
import type { EventCategory } from "@/types/events";

export type ChartSpec =
  | { id: string; kind: "events"; title: string; type?: EventCategory | null; source?: string | null; country?: string | null; days: number }
  | { id: string; kind: "price"; title: string; symbol: string; range: "1mo" | "6mo" | "1y" | "5y" }
  | { id: string; kind: "macro"; title: string; indicator: string };

export const DEFAULT_CHARTS: ChartSpec[] = [
  { id: "d1", kind: "events", title: "Earthquakes per day", type: "EARTHQUAKE", days: 7 },
  { id: "d2", kind: "events", title: "Conflict events per day", type: "CONFLICT", days: 7 },
  { id: "d3", kind: "price", title: "S&P 500", symbol: "^GSPC", range: "6mo" },
  { id: "d4", kind: "price", title: "Brent crude", symbol: "BZ=F", range: "6mo" },
];

/** Count timestamps into fixed buckets ending at `now` (oldest first). */
export function bucketCounts(timestamps: number[], now: number, days: number, bucketMs: number): Array<[number, number]> {
  const start = now - days * 86_400_000;
  const n = Math.ceil((now - start) / bucketMs);
  const out: Array<[number, number]> = Array.from({ length: n }, (_, i) => [start + i * bucketMs, 0]);
  for (const t of timestamps) {
    if (t < start || t > now) continue;
    const i = Math.min(n - 1, Math.floor((t - start) / bucketMs));
    out[i][1]++;
  }
  return out;
}
