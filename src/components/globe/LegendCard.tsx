"use client";
/**
 * One card in the map's legend stack: a coloured title row that collapses the
 * body. Every overlay legend uses it, so the stack looks like one system; the
 * collapsed state is remembered per card in this browser.
 */
import { useState, type ReactNode } from "react";

const KEY = "worldview-legend-collapsed";

function readCollapsed(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, boolean>;
  } catch {
    return {};
  }
}

export function LegendCard({ id, title, color, children }: { id: string; title: ReactNode; color?: string; children: ReactNode }) {
  // Collapsed to a one-line title (with counts) until opened, so several legends never cover the globe.
  const [collapsed, setCollapsed] = useState(() => readCollapsed()[id] ?? true);
  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem(KEY, JSON.stringify({ ...readCollapsed(), [id]: next }));
    } catch {
      /* storage unavailable */
    }
  };
  return (
    <section className="glass pointer-events-auto w-[240px] rounded-md text-[11px] leading-snug" data-legend={id}>
      <button
        onClick={toggle}
        aria-expanded={!collapsed}
        title={collapsed ? "Show legend" : "Collapse legend"}
        className="flex w-full items-center justify-between gap-2 rounded-md px-3 py-1.5 text-left hover:bg-panel-hover"
      >
        <span className="meta truncate" style={color ? { color } : undefined}>
          {title}
        </span>
        <span aria-hidden className={`text-[9px] text-faint transition-transform ${collapsed ? "-rotate-90" : ""}`}>
          ▼
        </span>
      </button>
      {!collapsed && <div className="space-y-1 border-t border-line px-3 pt-1.5 pb-2">{children}</div>}
    </section>
  );
}
