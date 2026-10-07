"use client";
/**
 * Fetches events for the timeline span and keeps them fresh via the realtime
 * stream (SSE at /api/stream), falling back to polling if the stream drops.
 */
import { useCallback, useEffect, useRef } from "react";
import { api } from "./api";
import { useData } from "./data-store";
import { useUI } from "@/lib/store/ui";
import { rangeMs } from "@/lib/time";

const POLL_FALLBACK_MS = 90_000;
/** Minimum gap between background refreshes: with ~40 sources the server reports changes constantly. */
const MIN_REFRESH_GAP_MS = 15_000;

export function useLiveData() {
  const range = useUI((s) => s.range);
  const customRange = useUI((s) => s.customRange);
  const span = useUI((s) => s.timelineSpan);
  const autoRefresh = useUI((s) => s.settings.autoRefresh);
  const abortRef = useRef<AbortController | null>(null);
  const inFlight = useRef<Promise<void> | null>(null);
  const lastSilent = useRef(0);

  const fetchFrom = useCallback(() => {
    const now = Date.now();
    const spanMs = Math.max(rangeMs(span), range === "7d" ? rangeMs("7d") : 0);
    let from = now - spanMs;
    if (range === "custom" && customRange) from = Math.min(from, customRange.from);
    // Round to the minute so repeated fetches are cache-friendly.
    return new Date(Math.floor(from / 60_000) * 60_000).toISOString();
  }, [range, customRange, span]);

  const load = useCallback(
    async (opts: { silent?: boolean } = {}) => {
      // A background refresh never cancels a load that's already running (on a slow
      // machine that could cancel every download and nothing would ever arrive).
      if (opts.silent && inFlight.current) return;
      if (opts.silent) lastSilent.current = Date.now();
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      if (!opts.silent) useData.setState({ loading: true });
      const run = (async () => {
        const res = await api.events({ from: fetchFrom(), limit: "20000", sort: "recent" }, ctrl.signal);
        if (ctrl.signal.aborted) return;
        useData.setState({
          events: res.events,
          mode: res.mode,
          version: res.version,
          loading: false,
          error: null,
          lastFetchedAt: Date.now(),
        });
      })();
      inFlight.current = run.then(
        () => undefined,
        () => undefined,
      );
      try {
        await run;
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        useData.setState({ loading: false, error: (err as Error).message });
      } finally {
        if (abortRef.current === ctrl) inFlight.current = null;
      }
    },
    [fetchFrom],
  );

  // Initial + whenever the span changes
  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    api.meta().then((meta) => useData.setState({ meta, mode: meta.mode })).catch(() => {});
  }, []);

  // Realtime updates
  useEffect(() => {
    if (!autoRefresh) return;
    let debounce: ReturnType<typeof setTimeout> | null = null;
    let poll: ReturnType<typeof setInterval> | null = null;
    const schedule = () => {
      if (debounce) return;
      // Coalesce bursts and keep at least MIN_REFRESH_GAP_MS between refreshes.
      const wait = Math.max(2500, MIN_REFRESH_GAP_MS - (Date.now() - lastSilent.current));
      debounce = setTimeout(() => {
        debounce = null;
        void load({ silent: true });
      }, wait);
    };
    const es = new EventSource("/api/stream");
    es.addEventListener("events.changed", schedule);
    es.addEventListener("event.updated", (m) => {
      try {
        const { eventId } = JSON.parse((m as MessageEvent).data);
        useData.setState((s) => ({ eventRevision: { ...s.eventRevision, [eventId]: (s.eventRevision[eventId] ?? 0) + 1 } }));
      } catch {}
    });
    es.onerror = () => {
      // Browser auto-reconnects; keep a slow poll as a safety net meanwhile.
      if (!poll) poll = setInterval(() => void load({ silent: true }), POLL_FALLBACK_MS);
    };
    es.addEventListener("hello", () => {
      if (poll) {
        clearInterval(poll);
        poll = null;
      }
    });
    return () => {
      es.close();
      if (debounce) clearTimeout(debounce);
      if (poll) clearInterval(poll);
    };
  }, [autoRefresh, load]);

  return { reload: load };
}
