"use client";
import { BATTERY_SLOWDOWN, idleOnBattery, onBattery } from "./power";
import { useEffect, useState } from "react";

export interface LiveLayerResponse<T> {
  layerId: string;
  observedAt: string;
  retrievedAt: string;
  count: number;
  data: T;
  attribution: string;
  notes?: string[];
  stale: boolean;
}

/**
 * Polls a live layer while `enabled`. The server caches upstream data per the
 * layer's TTL, so frequent client polling never exceeds upstream quotas.
 * With `pauseWhenHidden`, polling stops while the tab is hidden and resumes
 * (with an immediate refresh) when it becomes visible again.
 */
export function useLiveLayer<T>(id: string | null, pollMs = 60_000, opts: { pauseWhenHidden?: boolean } = {}) {
  const pauseWhenHidden = !!opts.pauseWhenHidden;
  const [state, setState] = useState<{ id: string | null; data: LiveLayerResponse<T> | null; error: string | null; loading: boolean }>({
    id: null,
    data: null,
    error: null,
    loading: false,
  });

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    const ctrl = new AbortController();
    let lastAt = 0;
    const load = async (force = false) => {
      // Hidden tabs never poll on battery; when visible, battery stretches the interval.
      if ((pauseWhenHidden || onBattery()) && document.hidden) return;
      if (!force && idleOnBattery()) return;
      if (!force && onBattery() && Date.now() - lastAt < pollMs * BATTERY_SLOWDOWN - 1000) return;
      lastAt = Date.now();
      setState((s) => ({ ...s, id, loading: true, ...(s.id !== id ? { data: null, error: null } : {}) }));
      try {
        // "no-cache": revalidate with the ETag, so an unchanged layer comes back as a tiny 304.
        const res = await fetch(`/api/layers/${id}`, { signal: ctrl.signal, cache: "no-cache" });
        const body = await res.json();
        if (cancelled) return;
        if (!res.ok) setState({ id, data: null, error: body?.error ?? `Layer unavailable (${res.status})`, loading: false });
        else setState({ id, data: body as LiveLayerResponse<T>, error: null, loading: false });
      } catch (err) {
        if (!cancelled && (err as Error).name !== "AbortError") setState((s) => ({ ...s, error: (err as Error).message, loading: false }));
      }
    };
    void load(true);
    const t = setInterval(() => void load(), pollMs);
    const onVisible = () => {
      if (!document.hidden) void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      cancelled = true;
      ctrl.abort();
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [id, pollMs, pauseWhenHidden]);

  return state.id === id ? state : { id, data: null, error: null, loading: !!id };
}
