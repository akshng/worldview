"use client";
import { useMemo } from "react";
import { useData } from "@/lib/client/data-store";
import { computeStats } from "@/lib/events/stats";
import { useNow } from "@/lib/client/use-now";

/** Global stats for the current view — computed from events served by the API. */
export function StatsStrip() {
  const visible = useData((s) => s.visible);
  const now = useNow(30_000);
  const stats = useMemo(() => computeStats(visible, now), [visible, now]);
  const items = [
    { label: "Events in view", value: stats.totalEvents },
    { label: "Last hour", value: stats.lastHour },
    { label: "High importance", value: stats.highImportance, tone: stats.highImportance ? "#ff8a3d" : undefined },
    { label: "Countries", value: stats.countriesAffected },
    { label: "Active hazards", value: stats.activeDisasters },
  ];
  return (
    <div className="glass pointer-events-auto flex rounded-md">
      {items.map((it, i) => (
        <div key={it.label} className={i ? "border-l border-line px-3 py-2" : "px-3 py-2"}>
          <div className="meta whitespace-nowrap text-faint">{it.label}</div>
          <div className="tabular mt-0.5 text-[17px] font-medium leading-none" style={{ color: it.tone }}>
            {it.value.toLocaleString("en-US")}
          </div>
        </div>
      ))}
    </div>
  );
}
