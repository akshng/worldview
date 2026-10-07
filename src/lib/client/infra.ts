"use client";
/** Strategic-infrastructure data in the browser: lazy GeoJSON loads and the chokepoint monitor. */
import { useEffect } from "react";
import { create } from "zustand";
import { infraUrl, type InfraMeta } from "@/lib/infra/catalog";
import type { ChokepointMonitor } from "@/lib/infra/chokepoints";

const files = new Map<string, Promise<GeoJSON.FeatureCollection>>();

/** Fetch /geo/infra/<file>.geojson once (retried on failure). */
export function loadInfraFile(file: string): Promise<GeoJSON.FeatureCollection> {
  let p = files.get(file);
  if (!p) {
    p = fetch(infraUrl(file))
      .then((r) => (r.ok ? (r.json() as Promise<GeoJSON.FeatureCollection>) : Promise.reject(new Error(`HTTP ${r.status}`))))
      .catch((err) => {
        files.delete(file);
        throw err;
      });
    files.set(file, p);
  }
  return p;
}

let metaPromise: Promise<InfraMeta | null> | null = null;
export const loadInfraMeta = () =>
  (metaPromise ??= fetch("/geo/infra/meta.json")
    .then((r) => (r.ok ? (r.json() as Promise<InfraMeta>) : null))
    .catch(() => null));

interface InfraState {
  monitor: ChokepointMonitor | null;
  monitorError: string | null;
  monitorLoading: boolean;
  /** Per layer: "loading" | "error" | count of features */
  status: Record<string, "loading" | "error" | number>;
  setStatus: (id: string, s: "loading" | "error" | number) => void;
}

export const useInfra = create<InfraState>()((set) => ({
  monitor: null,
  monitorError: null,
  monitorLoading: false,
  status: {},
  setStatus: (id, s) => set((st) => ({ status: { ...st.status, [id]: s } })),
}));

async function refreshMonitor() {
  useInfra.setState({ monitorLoading: true });
  try {
    const r = await fetch("/api/infra/chokepoints?days=7");
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    useInfra.setState({ monitor: (await r.json()) as ChokepointMonitor, monitorError: null, monitorLoading: false });
  } catch (err) {
    useInfra.setState({ monitorError: err instanceof Error ? err.message : String(err), monitorLoading: false });
  }
}

/** Poll the chokepoint monitor (every 5 min) while `enabled`. */
export function useChokepointMonitor(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    void refreshMonitor();
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void refreshMonitor();
    }, 5 * 60_000);
    return () => clearInterval(t);
  }, [enabled]);
}
