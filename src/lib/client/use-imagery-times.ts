"use client";
import { useEffect, useState } from "react";
import type { ImageryLatestResponse } from "@/lib/imagery";

/**
 * Latest NASA GIBS image times, re-checked every `pollMs` while `enabled` and
 * only while the tab is visible (with an immediate check when it becomes visible
 * again). The server caches the lookup for 5 minutes.
 */
export function useImageryTimes(enabled: boolean, pollMs = 5 * 60_000) {
  const [state, setState] = useState<{ data: ImageryLatestResponse | null; error: string | null }>({ data: null, error: null });

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let last = 0;
    const ctrl = new AbortController();
    const load = async () => {
      if (document.hidden) return;
      last = Date.now();
      try {
        const res = await fetch("/api/imagery/latest", { signal: ctrl.signal, cache: "no-store" });
        const body = await res.json();
        if (cancelled) return;
        if (!res.ok) setState((s) => ({ ...s, error: body?.error ?? `Imagery times unavailable (${res.status})` }));
        else setState({ data: body as ImageryLatestResponse, error: null });
      } catch (err) {
        if (!cancelled && (err as Error).name !== "AbortError") setState((s) => ({ ...s, error: (err as Error).message }));
      }
    };
    void load();
    const t = setInterval(load, pollMs);
    const onVisible = () => {
      if (!document.hidden && Date.now() - last > 60_000) void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      ctrl.abort();
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled, pollMs]);

  return enabled ? state : { data: null, error: null };
}
