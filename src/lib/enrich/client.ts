"use client";
/**
 * Client side of the event enrichments: a lazy fetch hook with a small
 * in-memory cache (so reopening a panel doesn't refetch), and the ShakeMap
 * overlay state shared by the event panel (toggle) and the globe (drawing).
 */
import { useEffect, useState } from "react";
import { create } from "zustand";
import type { MmiContours } from "./usgs";

const TTL_MS = 10 * 60_000;
const cache = new Map<string, { at: number; data: unknown }>();

/** Fetch JSON from one of our own /api/enrich routes while `url` is non-null. */
export function useEnrich<T>(url: string | null): { data: T | null; loading: boolean; error: string | null } {
  const [state, setState] = useState<{ url: string | null; data: T | null; error: string | null }>({ url: null, data: null, error: null });
  useEffect(() => {
    if (!url) return;
    const hit = cache.get(url);
    if (hit && Date.now() - hit.at < TTL_MS) {
      setState({ url, data: hit.data as T, error: null }); // eslint-disable-line react-hooks/set-state-in-effect
      return;
    }
    const ctrl = new AbortController();
    fetch(url, { signal: ctrl.signal })
      .then(async (r) => {
        const body = await r.json().catch(() => null);
        if (!r.ok) throw new Error((body as { error?: string } | null)?.error ?? `HTTP ${r.status}`);
        return body as T;
      })
      .then((data) => {
        cache.set(url, { at: Date.now(), data });
        if (cache.size > 100) cache.delete(cache.keys().next().value as string);
        setState({ url, data, error: null });
      })
      .catch((e: Error) => e.name !== "AbortError" && setState({ url, data: null, error: e.message }));
    return () => ctrl.abort();
  }, [url]);
  const current = url !== null && state.url === url;
  return { data: current ? state.data : null, loading: url !== null && !current, error: current ? state.error : null };
}

// ---- ShakeMap overlay ------------------------------------------------------------------

interface ShakeOverlayState {
  /** The WorldEvent the overlay belongs to; the globe clears it when that event is deselected. */
  eventId: string | null;
  usgsId: string | null;
  data: MmiContours | null;
  loading: boolean;
  error: string | null;
  show: (eventId: string, usgsId: string) => void;
  clear: () => void;
}

export const useShakeOverlay = create<ShakeOverlayState>()((set, get) => ({
  eventId: null,
  usgsId: null,
  data: null,
  loading: false,
  error: null,
  show: (eventId, usgsId) => {
    set({ eventId, usgsId, data: null, loading: true, error: null });
    fetch(`/api/enrich/earthquake/shakemap?id=${encodeURIComponent(usgsId)}`)
      .then(async (r) => {
        const body = await r.json().catch(() => null);
        if (!r.ok) throw new Error((body as { error?: string } | null)?.error ?? `HTTP ${r.status}`);
        return body as MmiContours;
      })
      .then((data) => get().usgsId === usgsId && set({ data, loading: false }))
      .catch((e: Error) => get().usgsId === usgsId && set({ loading: false, error: e.message }));
  },
  clear: () => set({ eventId: null, usgsId: null, data: null, loading: false, error: null }),
}));
