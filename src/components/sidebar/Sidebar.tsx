"use client";
import clsx from "clsx";
import { useMemo, useState } from "react";
import { CATEGORY_LIST, IMPORTANCE_FILTERS } from "@/lib/categories";
import { useUI } from "@/lib/store/ui";
import { MAP_MODES } from "@/lib/map-modes";
import { useData } from "@/lib/client/data-store";
import { TIME_RANGES } from "@/lib/time";
import { EVENT_CATEGORIES } from "@/types/events";
import { ChevronLeftIcon, ChevronRightIcon } from "@/components/ui/icons";
import { SectionTitle } from "@/components/ui/primitives";
import { PlotPanel } from "./PlotPanel";



function toLocalInput(t: number) {
  const d = new Date(t - new Date().getTimezoneOffset() * 60_000);
  return d.toISOString().slice(0, 16);
}

export function Sidebar() {
  const collapsed = useUI((s) => s.sidebarCollapsed);
  const setCollapsed = useUI((s) => s.setSidebarCollapsed);
  const categories = useUI((s) => s.categories);
  const toggle = useUI((s) => s.toggleCategory);
  const setCategories = useUI((s) => s.setCategories);
  const range = useUI((s) => s.range);
  const setRange = useUI((s) => s.setRange);
  const customRange = useUI((s) => s.customRange);
  const setCustomRange = useUI((s) => s.setCustomRange);
  const importance = useUI((s) => s.importance);
  const setImportance = useUI((s) => s.setImportance);
  const mapMode = useUI((s) => s.mapMode);
  const setMapMode = useUI((s) => s.setMapMode);
  const events = useData((s) => s.events);
  const [customOpen, setCustomOpen] = useState(false);

  // Counts reflect the fetched span, regardless of layer toggles.
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const e of events) c[e.type] = (c[e.type] ?? 0) + 1;
    return c;
  }, [events]);

  if (collapsed) {
    return (
      <aside className="flex w-10 shrink-0 flex-col items-center border-r border-line bg-bg py-2">
        <button onClick={() => setCollapsed(false)} className="rounded p-1.5 text-muted hover:bg-panel-hover hover:text-fg" title="Expand sidebar" aria-label="Expand sidebar">
          <ChevronRightIcon />
        </button>
      </aside>
    );
  }

  const enabled = new Set(categories);
  const focus = MAP_MODES.find((m) => m.id === mapMode)?.categories ?? null;

  return (
    <aside className="scroll-thin flex w-[260px] shrink-0 flex-col overflow-y-auto border-r border-line bg-bg">
      <div className="flex items-center justify-between px-4 pt-3 pb-1">
        <span className="meta text-faint">Plot</span>
        <button onClick={() => setCollapsed(true)} className="rounded p-1 text-faint hover:bg-panel-hover hover:text-fg" title="Collapse sidebar" aria-label="Collapse sidebar">
          <ChevronLeftIcon width={14} height={14} />
        </button>
      </div>
      <PlotPanel />

      <section className="border-t border-line px-4 py-3">
        <SectionTitle
          right={
            <span className="meta flex gap-2 text-faint">
              <button className="hover:text-fg" onClick={() => setCategories([...EVENT_CATEGORIES])}>All</button>
              <button className="hover:text-fg" onClick={() => setCategories([])}>None</button>
            </span>
          }
        >
          Layers
        </SectionTitle>
        {focus && (
          <p className="mb-2 rounded border border-accent/25 bg-accent-soft px-2 py-1 text-[11px] leading-snug text-accent">
            {MAP_MODES.find((m) => m.id === mapMode)?.label} mode shows only its own categories.{" "}
            <button className="underline" onClick={() => setMapMode("events")}>Back to all events</button>
          </p>
        )}
        <ul className="space-y-px">
          {CATEGORY_LIST.map((c) => {
            const on = enabled.has(c.id);
            const n = counts[c.id] ?? 0;
            return (
              <li key={c.id}>
                <label className={clsx("group flex cursor-pointer items-center gap-2.5 rounded px-1.5 py-[5px] hover:bg-panel-hover", !on && "opacity-50")}>
                  <input type="checkbox" checked={on} onChange={() => toggle(c.id)} className="peer sr-only" />
                  <span
                    className="grid h-3.5 w-3.5 place-items-center rounded-[3px] border peer-focus-visible:outline peer-focus-visible:outline-1 peer-focus-visible:outline-accent"
                    style={{ borderColor: on ? c.color : "rgba(255,255,255,0.2)", background: on ? `${c.color}26` : "transparent" }}
                  >
                    {on && <span className="h-1.5 w-1.5 rounded-[1px]" style={{ background: c.color }} />}
                  </span>
                  <span className="flex-1 text-[12.5px]">{c.layerLabel}</span>
                  <span className={clsx("meta tabular", n ? "text-muted" : "text-faint/60")}>{n || "—"}</span>
                </label>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="border-t border-line px-4 py-3">
        <SectionTitle>Time</SectionTitle>
        <div className="space-y-px">
          {TIME_RANGES.map((r) => (
            <button
              key={r.id}
              onClick={() => setRange(r.id)}
              className={clsx("flex w-full items-center gap-2.5 rounded px-1.5 py-[5px] text-left text-[12.5px] hover:bg-panel-hover", range === r.id ? "text-fg" : "text-muted")}
            >
              <span className={clsx("h-3 w-3 rounded-full border", range === r.id ? "border-accent bg-accent/30" : "border-white/20")} />
              {r.label}
            </button>
          ))}
          <button
            onClick={() => setCustomOpen((v) => !v)}
            className={clsx("flex w-full items-center gap-2.5 rounded px-1.5 py-[5px] text-left text-[12.5px] hover:bg-panel-hover", range === "custom" ? "text-fg" : "text-muted")}
          >
            <span className={clsx("h-3 w-3 rounded-full border", range === "custom" ? "border-accent bg-accent/30" : "border-white/20")} />
            Custom…
          </button>
          {customOpen && (
            <CustomRange initial={customRange} onApply={(r) => setCustomRange(r)} />
          )}
        </div>
      </section>

      <section className="border-t border-line px-4 py-3">
        <SectionTitle>Importance</SectionTitle>
        <div className="grid grid-cols-2 gap-1">
          {IMPORTANCE_FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => setImportance(f.id)}
              className={clsx(
                "rounded border px-2 py-1 text-[11.5px] transition-colors",
                importance === f.id ? "border-accent/50 bg-accent-soft text-accent" : "border-line text-muted hover:text-fg",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </section>

      <section className="border-t border-line px-4 py-3">
        <SectionTitle>View mode</SectionTitle>
        <div className="grid grid-cols-3 gap-1">
          {MAP_MODES.map((m) => (
            <button
              key={m.id}
              title={m.description}
              onClick={() => setMapMode(m.id)}
              className={clsx(
                "rounded border px-1.5 py-1 text-[11px]",
                mapMode === m.id ? "border-accent/50 bg-accent-soft text-accent" : "border-line text-muted hover:text-fg",
              )}
            >
              {m.label}
            </button>
          ))}
        </div>
      </section>
      <div className="flex-1" />
    </aside>
  );
}

function CustomRange({ initial, onApply }: { initial: { from: number; to: number } | null; onApply: (r: { from: number; to: number }) => void }) {
  const [openedAt] = useState(() => Date.now());
  const [from, setFrom] = useState(() => toLocalInput(initial?.from ?? openedAt - 12 * 3_600_000));
  const [to, setTo] = useState(() => toLocalInput(initial?.to ?? openedAt));
  const f = Date.parse(from), t = Date.parse(to);
  const valid = Number.isFinite(f) && Number.isFinite(t) && f < t && openedAt - f <= 8 * 86_400_000;
  return (
    <div className="mt-1 space-y-1.5 rounded border border-line p-2">
      <label className="meta block text-faint">From<input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} className="mt-0.5 block w-full rounded border border-line bg-bg-elev px-1.5 py-1 text-[11.5px] normal-case tracking-normal text-fg" /></label>
      <label className="meta block text-faint">To<input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} className="mt-0.5 block w-full rounded border border-line bg-bg-elev px-1.5 py-1 text-[11.5px] normal-case tracking-normal text-fg" /></label>
      <button disabled={!valid} onClick={() => onApply({ from: f, to: t })} className="w-full rounded bg-accent-soft py-1 text-[11.5px] text-accent disabled:opacity-40">
        Apply
      </button>
      {!valid && <p className="text-[10.5px] text-faint">Range must be within the last 8 days (retention window).</p>}
    </div>
  );
}
