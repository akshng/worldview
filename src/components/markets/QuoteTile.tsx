"use client";
import clsx from "clsx";
import type { Quote } from "@/lib/finance/types";
import { DOWN, UP, formatChange, formatPrice } from "@/lib/finance/format";
import { relativeTime } from "@/lib/time";
import { Sparkline } from "./Sparkline";

/** Stat tile: name · value · signed delta (arrow + colour, never colour alone) · sparkline. */
export function QuoteTile({ q, onRemove, compact }: { q: Quote; onRemove?: () => void; compact?: boolean }) {
  const ch = formatChange(q);
  const color = ch.dir > 0 ? UP : ch.dir < 0 ? DOWN : "var(--text-muted)";
  const arrow = ch.dir > 0 ? "▲" : ch.dir < 0 ? "▼" : "■";
  const range = q.spark.length ? `${q.name}: ${Math.min(...q.spark).toFixed(2)}–${Math.max(...q.spark).toFixed(2)} over recent sessions` : q.name;
  return (
    <div
      className={clsx("group relative flex items-center justify-between gap-2 rounded border border-line px-2.5", compact ? "py-1.5" : "py-2")}
      title={`${q.name} (${q.symbol}) · ${q.source}${q.asOf ? ` · ${relativeTime(q.asOf)}` : ""}${q.error ? ` · ${q.error}` : ""}`}
    >
      <div className="min-w-0">
        <div className="truncate text-[11.5px] text-muted">{q.name}</div>
        <div className="mt-0.5 flex items-baseline gap-2">
          <span className="text-[14px] font-medium">{formatPrice(q)}</span>
          <span className="tabular text-[11.5px]" style={{ color }}>
            {arrow} {ch.text}
          </span>
        </div>
      </div>
      {q.error ? <span className="text-[10.5px] text-faint">n/a</span> : <Sparkline values={q.spark} color={color} label={range} />}
      {onRemove && (
        <button onClick={onRemove} aria-label={`Remove ${q.symbol}`} className="absolute -top-1.5 -right-1.5 hidden h-4 w-4 rounded-full bg-panel-solid text-[10px] text-muted ring-1 ring-line group-hover:block hover:text-fg">
          ×
        </button>
      )}
    </div>
  );
}
