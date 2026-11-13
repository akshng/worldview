"use client";
import clsx from "clsx";
import { useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useUI } from "@/lib/store/ui";
import { useData } from "@/lib/client/data-store";
import { relativeTime } from "@/lib/time";
import { recencyKey } from "@/lib/events/query";
import { useNow } from "@/lib/client/use-now";
import { CategoryLabel, ImportanceMeter, SimulatedBadge } from "@/components/ui/primitives";
import type { EventSummary } from "@/types/events";
import { ExportMenu } from "./ExportMenu";

const ROW_H = 98;

export function focusEvent(e: Pick<EventSummary, "id" | "latitude" | "longitude">) {
  const ui = useUI.getState();
  ui.selectEvent(e.id);
  ui.requestFlyTo({ lon: e.longitude, lat: e.latitude, zoom: 4.2 });
}

export function EventFeed({ wide = false }: { wide?: boolean } = {}) {
  const visible = useData((s) => s.visible);
  const loading = useData((s) => s.loading);
  const error = useData((s) => s.error);
  const mode = useData((s) => s.mode);
  const totalFetched = useData((s) => s.events.length);
  const sort = useUI((s) => s.feedSort);
  const setSort = useUI((s) => s.setFeedSort);
  const selectedId = useUI((s) => s.selectedEventId);
  const hoveredId = useUI((s) => s.hoveredEventId);
  const setHovered = useUI((s) => s.setHovered);
  const now = useNow(30_000);
  const parent = useRef<HTMLDivElement>(null);

  const items = useMemo(() => {
    const list = [...visible];
    return sort === "importance"
      ? list.sort((a, b) => b.importanceScore - a.importanceScore || recencyKey(b, now) - recencyKey(a, now))
      : list.sort((a, b) => recencyKey(b, now) - recencyKey(a, now) || b.importanceScore - a.importanceScore);
  }, [visible, sort, now]);

  const virt = useVirtualizer({ count: items.length, getScrollElement: () => parent.current, estimateSize: () => ROW_H, overscan: 8 });

  return (
    <aside className={wide ? "flex w-[min(640px,50%)] shrink-0 flex-col border-r border-line bg-bg" : "flex w-[360px] shrink-0 flex-col border-l border-line bg-bg"}>
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-line px-4">
        <div className="flex items-center gap-2">
          <span className="meta text-fg">Live feed</span>
          <span className="meta tabular text-faint">{items.length.toLocaleString("en-US")}</span>
        </div>
        <div className="flex items-center gap-2">
        <ExportMenu events={items} label={wide ? "news" : "world-feed"} />
        <div className="flex rounded border border-line p-[2px]">
          {(["recent", "importance"] as const).map((s) => (
            <button key={s} onClick={() => setSort(s)} className={clsx("meta rounded-[3px] px-2 py-0.5", sort === s ? "bg-panel-hover text-fg" : "text-faint hover:text-muted")}>
              {s === "recent" ? "Latest" : "Important"}
            </button>
          ))}
        </div>
        </div>
      </div>

      <div ref={parent} className="scroll-thin relative flex-1 overflow-y-auto">
        {items.length === 0 && (
          <div className="px-6 py-10 text-center text-[12.5px] leading-relaxed text-muted">
            {loading ? (
              "Loading events…"
            ) : error ? (
              <>Could not load events: {error}</>
            ) : totalFetched === 0 ? (
              <>
                <div className="mb-1 text-fg">No data available</div>
                {mode === "live"
                  ? "No events have been ingested yet. Sources may still be loading or unavailable — check Settings → Data sources."
                  : "Demo generator has not produced events yet."}
              </>
            ) : (
              "No events match the current filters."
            )}
          </div>
        )}
        <div style={{ height: virt.getTotalSize(), position: "relative" }}>
          {virt.getVirtualItems().map((row) => {
            const e = items[row.index];
            const future = Date.parse(e.timestamp) > now;
            return (
              <button
                key={e.id}
                onClick={() => focusEvent(e)}
                onMouseEnter={() => setHovered(e.id)}
                onMouseLeave={() => hoveredId === e.id && setHovered(null)}
                className={clsx(
                  "absolute left-0 w-full border-b border-line px-4 py-2.5 text-left transition-colors",
                  selectedId === e.id ? "bg-accent-soft" : hoveredId === e.id ? "bg-panel-hover" : "hover:bg-panel-hover",
                )}
                style={{ top: row.start, height: ROW_H }}
              >
                <div className="flex items-center justify-between gap-2">
                  <CategoryLabel type={e.type} />
                  <div className="flex items-center gap-2">
                    {e.isSynthetic && <SimulatedBadge />}
                    <ImportanceMeter score={e.importanceScore} />
                  </div>
                </div>
                <div className="mt-1 line-clamp-2 text-[13px] leading-snug font-medium text-fg">{e.title}</div>
                <div className="meta mt-1.5 flex items-center gap-1.5 truncate normal-case tracking-[0.02em] text-faint">
                  <span className="truncate text-muted">{e.countryName ?? e.locationName ?? "Unknown location"}</span>
                  <span>·</span>
                  <span className={clsx("shrink-0", future && "text-accent")}>{relativeTime(e.timestamp, now)}</span>
                  <span>·</span>
                  <span className="shrink-0">{e.sourceCount} source{e.sourceCount === 1 ? "" : "s"}</span>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </aside>
  );
}
