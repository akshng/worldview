"use client";
/**
 * Bottom timeline: event histogram + draggable replay cursor.
 * Dragging moves the end of the visible window back in time; "Live" snaps back.
 */
import clsx from "clsx";
import { useCallback, useMemo, useRef } from "react";
import { REPLAY_SPEEDS, useUI } from "@/lib/store/ui";
import { startReplay, useReplay } from "./use-replay";
import { useData } from "@/lib/client/data-store";
import { useNow } from "@/lib/client/use-now";
import { formatClock, rangeMs } from "@/lib/time";

export function Timeline() {
  const span = useUI((s) => s.timelineSpan);
  const setSpan = useUI((s) => s.setTimelineSpan);
  const cursor = useUI((s) => s.timelineCursor);
  const setCursor = useUI((s) => s.setTimelineCursor);
  const range = useUI((s) => s.range);
  const categories = useUI((s) => s.categories);
  const events = useData((s) => s.events);
  const now = useNow(30_000);
  const track = useRef<HTMLDivElement>(null);
  const playing = useUI((s) => s.replayPlaying);
  const speed = useUI((s) => s.replaySpeed);
  const setSpeed = useUI((s) => s.setReplaySpeed);
  const setPlaying = useUI((s) => s.setReplayPlaying);
  useReplay();

  const spanMs = rangeMs(span);
  const start = now - spanMs;
  const bins = span === "24h" ? 96 : 84; // 15-min / 2-h bins
  const binMs = spanMs / bins;
  const windowMs = range === "custom" ? 0 : rangeMs(range);

  const hist = useMemo(() => {
    const enabled = new Set(categories);
    const counts = new Array<number>(bins).fill(0);
    const high = new Array<number>(bins).fill(0);
    for (const e of events) {
      if (!enabled.has(e.type)) continue;
      const t = Date.parse(e.timestamp);
      if (t < start || t > now) continue;
      const i = Math.min(bins - 1, Math.floor((t - start) / binMs));
      counts[i]++;
      if (e.importanceScore > 60) high[i]++;
    }
    return { counts, high, max: Math.max(1, ...counts) };
  }, [events, categories, bins, binMs, start, now]);

  const end = cursor ?? now;
  const pct = (t: number) => Math.max(0, Math.min(100, ((t - start) / spanMs) * 100));

  const fromPointer = useCallback(
    (clientX: number) => {
      const el = track.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const x = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
      const t = start + x * spanMs;
      // Snap to live in the last 1% of the track.
      setCursor(x > 0.99 ? null : Math.round(t / 60_000) * 60_000);
    },
    [start, spanMs, setCursor],
  );

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    fromPointer(e.clientX);
  };

  const ticks = useMemo(() => {
    const out: Array<{ t: number; label: string }> = [];
    const step = span === "24h" ? 2 * 3_600_000 : 86_400_000;
    const first = Math.ceil(start / step) * step;
    for (let t = first; t < now - step * 0.3; t += step) {
      out.push({ t, label: span === "24h" ? formatClock(t) : new Date(t).toLocaleDateString([], { weekday: "short", day: "numeric" }) });
    }
    return out;
  }, [start, now, span]);

  const onKey = (e: React.KeyboardEvent) => {
    const stepMs = span === "24h" ? 15 * 60_000 : 2 * 3_600_000;
    if (e.key === "ArrowLeft") setCursor(Math.max(start, end - stepMs));
    else if (e.key === "ArrowRight") setCursor(end + stepMs >= now ? null : end + stepMs);
    else if (e.key === "End") setCursor(null);
    else return;
    e.preventDefault();
  };

  return (
    <div className="glass pointer-events-auto flex h-[72px] items-stretch rounded-md">
      <div className="flex w-[176px] shrink-0 flex-col justify-center gap-1.5 border-r border-line px-2.5">
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => (playing ? setPlaying(false) : startReplay())}
            className={clsx("meta flex items-center gap-1 rounded border px-1.5 py-[3px] leading-none", playing ? "border-warn/50 text-warn" : "border-line text-muted hover:text-fg")}
            title={playing ? "Pause replay" : "Replay the last 7 days (Esc returns to live)"}
            aria-label={playing ? "Pause replay" : "Play replay"}
          >
            <span aria-hidden>{playing ? "❚❚" : "▶"}</span>
            {playing ? "Pause" : "Replay"}
          </button>
          <div className="flex rounded border border-line p-[1px]" role="radiogroup" aria-label="Replay speed">
            {REPLAY_SPEEDS.map((v) => (
              <button
                key={v}
                role="radio"
                aria-checked={speed === v}
                onClick={() => setSpeed(v)}
                title={`${v} hour${v === 1 ? "" : "s"} per second`}
                className={clsx("meta rounded-[3px] px-1 py-[2px] leading-none normal-case", speed === v ? "bg-panel-hover text-fg" : "text-faint hover:text-muted")}
              >
                {v}×
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setCursor(null)}
            className={clsx("meta flex items-center gap-1.5 text-left", cursor === null ? "text-live" : "text-muted hover:text-fg")}
            title="Return to live (Esc)"
          >
            <span className={clsx("h-1.5 w-1.5 rounded-full", cursor === null ? "bg-live" : "bg-faint")} />
            Live
          </button>
          <span className={clsx("meta tabular normal-case", cursor === null ? "text-faint" : "text-warn")} aria-live="off">
            {cursor === null ? "Now" : `${new Date(cursor).toLocaleDateString([], { weekday: "short", day: "numeric" })} ${formatClock(cursor)}`}
          </span>
        </div>
      </div>

      <div className="relative flex-1 px-3 pt-2 pb-5">
        <div
          ref={track}
          role="slider"
          tabIndex={0}
          aria-label="Timeline replay position"
          aria-valuemin={start}
          aria-valuemax={now}
          aria-valuenow={end}
          aria-valuetext={cursor === null ? "Live" : new Date(end).toLocaleString()}
          onPointerDown={onPointerDown}
          onPointerMove={(e) => e.buttons === 1 && fromPointer(e.clientX)}
          onKeyDown={onKey}
          className="relative h-full cursor-ew-resize touch-none select-none focus:outline-none"
        >
          {/* visible window shading */}
          {windowMs > 0 && (
            <div
              className="absolute inset-y-0 rounded-sm bg-accent/[0.07]"
              style={{ left: `${pct(end - windowMs)}%`, right: `${100 - pct(end)}%` }}
            />
          )}
          {/* histogram */}
          <div className="absolute inset-0 flex items-end gap-px">
            {hist.counts.map((c, i) => {
              const binEnd = start + (i + 1) * binMs;
              const inWin = binEnd <= end + binMs && binEnd > end - windowMs;
              return (
                <div key={i} className="relative flex-1" style={{ height: `${(c / hist.max) * 100}%`, minHeight: c ? 2 : 0 }}>
                  <div className={clsx("absolute inset-0 rounded-[1px]", inWin ? "bg-accent/45" : "bg-white/12")} />
                  {hist.high[i] > 0 && (
                    <div className="absolute inset-x-0 bottom-0 rounded-[1px] bg-[#ff8a3d]/80" style={{ height: `${(hist.high[i] / c) * 100}%` }} />
                  )}
                </div>
              );
            })}
          </div>
          {/* cursor */}
          <div className="pointer-events-none absolute inset-y-[-4px] w-px bg-fg/80" style={{ left: `${pct(end)}%` }}>
            <div className="absolute -top-1 -left-[4px] h-2 w-[9px] rounded-sm bg-fg" />
          </div>
        </div>
        {/* tick labels */}
        <div className="pointer-events-none absolute inset-x-3 bottom-1 h-3">
          {ticks.map((t) => (
            <span key={t.t} className="meta tabular absolute -translate-x-1/2 text-[9.5px] text-faint" style={{ left: `${pct(t.t)}%` }}>
              {t.label}
            </span>
          ))}
          <span className="meta absolute right-0 text-[9.5px] text-live">Now</span>
        </div>
      </div>

      <div className="flex shrink-0 flex-col justify-center gap-0.5 border-l border-line px-2">
        {(["24h", "7d"] as const).map((s) => (
          <button key={s} onClick={() => setSpan(s)} className={clsx("meta rounded px-2 py-[3px] leading-none", span === s ? "bg-panel-hover text-fg" : "text-faint hover:text-muted")}>
            {s.toUpperCase()}
          </button>
        ))}
      </div>
    </div>
  );
}
