"use client";
/**
 * 7-day replay: while playing, the timeline cursor advances by `replaySpeed` hours per
 * second; the globe and feed follow it through the normal time filter (they already read
 * the cursor). Paused while the page is hidden, fewer updates on battery, Esc → live.
 */
import { useEffect } from "react";
import { useUI } from "@/lib/store/ui";
import { onBattery } from "@/lib/client/power";
import { rangeMs } from "@/lib/time";

export const REPLAY_SPAN_MS = 7 * 86_400_000;
const FRAME_MS = 250;
const BATTERY_FRAME_MS = 1000;

/** Next cursor position, or null once it reaches "now" (replay is over → live). */
export function advanceCursor(cursor: number, speedHoursPerSec: number, elapsedMs: number, now: number): number | null {
  const next = cursor + speedHoursPerSec * 3_600_000 * (elapsedMs / 1000);
  return next >= now ? null : Math.round(next);
}

/** Start (or resume) playback. From live, starts 7 days back, one visible window in. */
export function startReplay(now = Date.now()) {
  const ui = useUI.getState();
  // A 7-day window would show everything at once; replay with a sliding 24 h window instead.
  if (ui.range === "7d" || ui.range === "custom") ui.setRange("24h");
  if (useUI.getState().timelineSpan !== "7d") useUI.getState().setTimelineSpan("7d");
  const s = useUI.getState();
  const win = s.range === "custom" ? rangeMs("24h") : rangeMs(s.range);
  const cursor = s.timelineCursor;
  const startAt = now - REPLAY_SPAN_MS + Math.min(win, 86_400_000);
  // Resume from a scrubbed position; restart if parked at (or near) the end.
  useUI.setState({ timelineCursor: cursor !== null && cursor < now - 60_000 ? cursor : startAt, replayPlaying: true });
}

export function useReplay() {
  const playing = useUI((s) => s.replayPlaying);
  const speed = useUI((s) => s.replaySpeed);
  const live = useUI((s) => s.timelineCursor === null);

  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      timer = setTimeout(tick, onBattery() ? BATTERY_FRAME_MS : FRAME_MS);
    };
    const tick = () => {
      const t = performance.now();
      const elapsed = Math.min(t - last, 2000);
      last = t;
      // Hidden page: don't advance (and don't jump ahead when it comes back).
      if (document.hidden) return schedule();
      const ui = useUI.getState();
      if (!ui.replayPlaying || ui.timelineCursor === null) return;
      ui.setTimelineCursor(advanceCursor(ui.timelineCursor, speed, elapsed, Date.now()));
      schedule();
    };
    schedule();
    return () => clearTimeout(timer);
  }, [playing, speed]);

  // Esc returns to live (unless a dialog or a detail panel wants the key first).
  useEffect(() => {
    if (live) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const ui = useUI.getState();
      if (ui.searchOpen || ui.settingsOpen || ui.selectedEventId || ui.selectedTrack || ui.selectedCountry || ui.selectedRegion !== null || ui.instrument) return;
      ui.setTimelineCursor(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [live]);
}
