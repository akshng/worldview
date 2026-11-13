"use client";
/** "Export" → CSV or GeoJSON of exactly the events on screen (after filters). Client-side download. */
import { useEffect, useRef, useState } from "react";
import { downloadText, eventsToCsv, eventsToGeoJSON, exportName, type ExportableEvent } from "@/lib/client/export";

export function ExportMenu({ events, label = "events" }: { events: ExportableEvent[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", off);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("mousedown", off);
      window.removeEventListener("keydown", esc);
    };
  }, [open]);

  const run = (fmt: "csv" | "geojson") => {
    setOpen(false);
    if (fmt === "csv") downloadText(exportName(label, "csv"), "text/csv", eventsToCsv(events));
    else downloadText(exportName(label, "geojson"), "application/geo+json", JSON.stringify(eventsToGeoJSON(events)));
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={!events.length}
        aria-haspopup="menu"
        aria-expanded={open}
        title={`Download the ${events.length.toLocaleString("en-US")} events shown`}
        className="meta rounded border border-line px-2 py-[3px] text-faint hover:text-fg disabled:opacity-40"
      >
        Export
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-30 mt-1 w-48 rounded-md border border-line bg-bg-elev py-1 text-[12.5px] shadow-xl shadow-black/50">
          <button role="menuitem" onClick={() => run("csv")} className="block w-full px-3 py-1.5 text-left hover:bg-panel-hover">
            CSV <span className="text-faint">· spreadsheet</span>
          </button>
          <button role="menuitem" onClick={() => run("geojson")} className="block w-full px-3 py-1.5 text-left hover:bg-panel-hover">
            GeoJSON <span className="text-faint">· maps / GIS</span>
          </button>
          <div className="border-t border-line px-3 pt-1.5 pb-1 text-[11px] text-faint">{events.length.toLocaleString("en-US")} events, current filters</div>
        </div>
      )}
    </div>
  );
}
