"use client";
/**
 * Hooks for the native Mac app (and plain links): open an event, a ticker or a
 * panel from outside the page — `window.worldview.open*()` for the app's menu
 * bar, and `?event=…`, `?ticker=…`, `?panel=…` on the URL.
 */
import { useEffect } from "react";
import { useUI } from "@/lib/store/ui";

const PANELS = {
  markets: "setMarketsOpen",
  analyst: "setAnalystOpen",
  briefing: "setBriefingOpen",
  planet: "setPlanetOpen",
  energy: "setEnergyOpen",
  security: "setSecurityOpen",
  trends: "setTrendsOpen",
  search: "setSearchOpen",
} as const;
export type PanelName = keyof typeof PANELS;

function openPanel(name: string) {
  const setter = PANELS[name as PanelName];
  if (setter) (useUI.getState()[setter] as (v: boolean) => void)(true);
}
function openTicker(symbol: string) {
  const s = useUI.getState();
  s.setMarketsOpen(true);
  s.openInstrument(symbol.toUpperCase());
}
function openEvent(id: string) {
  useUI.getState().selectEvent(id);
}

declare global {
  interface Window {
    worldview?: { openEvent: (id: string) => void; openTicker: (s: string) => void; openPanel: (p: string) => void };
  }
}

export function useAppBridge() {
  useEffect(() => {
    window.worldview = { openEvent, openTicker, openPanel };
    const q = new URLSearchParams(location.search);
    const ev = q.get("event");
    const tk = q.get("ticker");
    const pn = q.get("panel");
    if (ev && /^[\w-]{1,80}$/.test(ev)) openEvent(ev);
    if (tk && /^[A-Za-z0-9.^=-]{1,15}$/.test(tk)) openTicker(tk);
    if (pn) openPanel(pn);
    if (ev || tk || pn) history.replaceState(null, "", location.pathname);
    return () => {
      delete window.worldview;
    };
  }, []);
}
