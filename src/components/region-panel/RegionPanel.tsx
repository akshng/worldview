"use client";
/**
 * State/province overview: events (as currently filtered on the map) whose
 * location falls inside the selected region's boundary.
 */
import clsx from "clsx";
import { useEffect, useMemo, useState } from "react";
import { useUI } from "@/lib/store/ui";
import { useData } from "@/lib/client/data-store";
import { CATEGORIES } from "@/lib/categories";
import { relativeTime } from "@/lib/time";
import { pointInGeometry } from "@/lib/geo/math";
import { bboxOfGeometry, loadRegions, regionById, type RegionFeature } from "@/lib/client/regions";
import { CloseIcon } from "@/components/ui/icons";
import { ImportanceMeter, SectionTitle } from "@/components/ui/primitives";
import { focusEvent } from "@/components/event-feed/EventFeed";
import type { EventCategory } from "@/types/events";

export function RegionPanel() {
  const id = useUI((s) => s.selectedRegion);
  const visible = useData((s) => s.visible);
  const [region, setRegion] = useState<RegionFeature | null>(null);
  const [tab, setTab] = useState<"top" | "recent">("top");

  useEffect(() => {
    if (id === null) return;
    let cancelled = false;
    loadRegions().then(() => !cancelled && setRegion(regionById(id) ?? null)).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [id]);

  const r = region && region.id === id ? region : null;

  // Fly to the region once it's known.
  useEffect(() => {
    if (!r) return;
    const [w, s, e, n] = bboxOfGeometry(r.geometry);
    useUI.getState().requestFlyTo({ lon: (w + e) / 2, lat: (s + n) / 2, zoom: 5, bbox: [w, s, e, n] });
  }, [r]);

  const inside = useMemo(() => (r ? visible.filter((e) => pointInGeometry(e.longitude, e.latitude, r.geometry)) : []), [r, visible]);
  if (id === null) return null;

  const cats = Object.entries(
    inside.reduce<Record<string, number>>((acc, e) => {
      acc[e.type] = (acc[e.type] ?? 0) + 1;
      return acc;
    }, {}),
  ).sort((a, b) => b[1] - a[1]);
  const maxCat = Math.max(1, ...cats.map(([, n]) => n));
  const list = [...inside].sort((a, b) => (tab === "top" ? b.importanceScore - a.importanceScore : b.timestamp.localeCompare(a.timestamp))).slice(0, 30);

  return (
    <div className="glass panel-in pointer-events-auto flex max-h-full self-start w-[400px] flex-col rounded-md shadow-2xl shadow-black/50">
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <span className="meta text-faint">{r?.properties.type ?? "Region"} overview</span>
        <button onClick={() => useUI.getState().selectRegion(null)} className="rounded p-1 text-muted hover:bg-panel-hover hover:text-fg" aria-label="Close region overview">
          <CloseIcon width={14} height={14} />
        </button>
      </div>
      <div className="scroll-thin overflow-y-auto">
        {!r && <div className="p-6 text-[12.5px] text-muted">Loading…</div>}
        {r && (
          <>
            <div className="px-4 pt-3.5 pb-3">
              <h2 className="text-[19px] font-semibold tracking-[0.06em] uppercase">{r.properties.name}</h2>
              <div className="meta mt-1 text-faint">
                {[r.properties.type, r.properties.countryName].filter(Boolean).join(" · ")}{" "}
                <button onClick={() => useUI.getState().selectCountry(r.properties.country)} className="ml-1 normal-case tracking-normal text-accent hover:underline">
                  Country overview →
                </button>
              </div>
            </div>
            <div className="grid grid-cols-2 border-y border-line">
              {[
                { label: "Events on the map", value: inside.length },
                { label: "High importance", value: inside.filter((e) => e.importanceScore >= 60).length },
              ].map((s, i) => (
                <div key={s.label} className={clsx("px-4 py-2.5", i && "border-l border-line")}>
                  <div className="meta text-faint">{s.label}</div>
                  <div className="tabular mt-0.5 text-[18px] font-medium">{s.value}</div>
                </div>
              ))}
            </div>
            <section className="px-4 py-3.5">
              <SectionTitle>By category</SectionTitle>
              {cats.length === 0 ? (
                <p className="text-[12.5px] text-muted">No events in this region for the current time range and filters.</p>
              ) : (
                <ul className="space-y-1.5">
                  {cats.map(([type, n]) => {
                    const c = CATEGORIES[type as EventCategory];
                    return (
                      <li key={type} className="flex items-center gap-2 text-[12px]">
                        <span className="w-24 shrink-0 text-muted">{c?.label ?? type}</span>
                        <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/5">
                          <span className="block h-full rounded-full" style={{ width: `${(n / maxCat) * 100}%`, background: c?.color }} />
                        </span>
                        <span className="tabular w-8 text-right">{n}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
            {list.length > 0 && (
              <section className="border-t border-line px-4 py-3.5">
                <SectionTitle
                  right={
                    <span className="flex gap-1">
                      {(["top", "recent"] as const).map((t) => (
                        <button key={t} onClick={() => setTab(t)} className={clsx("meta rounded px-1.5 py-0.5", tab === t ? "bg-panel-hover text-fg" : "text-faint hover:text-muted")}>
                          {t === "top" ? "Major" : "Latest"}
                        </button>
                      ))}
                    </span>
                  }
                >
                  Events in {r.properties.name}
                </SectionTitle>
                <ul className="-mx-2">
                  {list.map((e) => (
                    <li key={e.id}>
                      <button onClick={() => focusEvent(e)} className="w-full rounded px-2 py-2 text-left hover:bg-panel-hover">
                        <div className="flex items-center justify-between gap-2">
                          <span className="meta" style={{ color: CATEGORIES[e.type].color }}>{CATEGORIES[e.type].label}</span>
                          <ImportanceMeter score={e.importanceScore} />
                        </div>
                        <div className="mt-0.5 line-clamp-2 text-[12.5px] leading-snug">{e.title}</div>
                        <div className="meta mt-0.5 normal-case tracking-[0.02em] text-faint">{relativeTime(e.timestamp)} · {e.sourceCount} source{e.sourceCount === 1 ? "" : "s"}</div>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <p className="px-4 pb-3 text-[10.5px] text-faint">Boundaries: Natural Earth admin-1 (simplified). Counts reflect the map&apos;s current time range and filters.</p>
          </>
        )}
      </div>
    </div>
  );
}
