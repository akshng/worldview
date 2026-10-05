/** Time-range presets and formatting helpers (client + server safe). */

export const TIME_RANGES = [
  { id: "live", label: "Live", short: "LIVE", ms: 30 * 60_000 },
  { id: "1h", label: "Last hour", short: "1H", ms: 60 * 60_000 },
  { id: "6h", label: "Last 6 hours", short: "6H", ms: 6 * 60 * 60_000 },
  { id: "24h", label: "Last 24 hours", short: "24H", ms: 24 * 60 * 60_000 },
  { id: "7d", label: "Last 7 days", short: "7D", ms: 7 * 24 * 60 * 60_000 },
] as const;
export type PresetRangeId = (typeof TIME_RANGES)[number]["id"];
export type TimeRangeId = PresetRangeId | "custom";

export function rangeMs(id: PresetRangeId): number {
  return TIME_RANGES.find((r) => r.id === id)!.ms;
}

export interface TimeWindow {
  from: number;
  /** null = open-ended (includes scheduled future events) */
  to: number | null;
}

/**
 * Visible window. With a timeline cursor the window ends at the cursor;
 * otherwise it is open-ended so upcoming scheduled events stay visible.
 */
export function visibleWindow(
  range: TimeRangeId,
  now: number,
  cursor: number | null,
  custom?: { from: number; to: number } | null,
): TimeWindow {
  if (range === "custom" && custom) return { from: custom.from, to: custom.to };
  const ms = rangeMs(range === "custom" ? "24h" : range);
  if (cursor !== null) return { from: cursor - ms, to: cursor };
  return { from: now - ms, to: null };
}

export function relativeTime(iso: string | number, now = Date.now()): string {
  const t = typeof iso === "number" ? iso : Date.parse(iso);
  const diff = now - t;
  const abs = Math.abs(diff);
  const future = diff < 0;
  const fmt = (n: number, u: string) => (future ? `in ${n} ${u}` : `${n} ${u} ago`);
  if (abs < 45_000) return future ? "in moments" : "just now";
  if (abs < 3_600_000) return fmt(Math.round(abs / 60_000), Math.round(abs / 60_000) === 1 ? "min" : "min");
  if (abs < 86_400_000) return fmt(Math.round(abs / 3_600_000), Math.round(abs / 3_600_000) === 1 ? "hour" : "hours");
  const d = Math.round(abs / 86_400_000);
  return fmt(d, d === 1 ? "day" : "days");
}

export function formatUtc(iso: string | number, withDate = true): string {
  const d = new Date(iso);
  const date = d.toISOString().slice(0, 10);
  const time = d.toISOString().slice(11, 16);
  return withDate ? `${date} ${time} UTC` : `${time} UTC`;
}

export function formatClock(t: number, utc = false): string {
  const d = new Date(t);
  return utc
    ? d.toISOString().slice(11, 16)
    : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}
