"use client";
/**
 * Strategic-infrastructure panel: independent layer toggles, keys, the
 * chokepoint monitor and dataset sources/licences.
 */
import { useEffect, useState } from "react";
import { useUI } from "@/lib/store/ui";
import { FUEL_COLORS, INFRA_DATASETS, INFRA_LAYERS, PIPELINE_COLORS, type InfraMeta } from "@/lib/infra/catalog";
import { LEVEL_COLORS } from "@/lib/infra/chokepoints";
import { loadInfraMeta, useInfra } from "@/lib/client/infra";
import { CATEGORIES } from "@/lib/categories";
import type { EventCategory } from "@/types/events";

const fmt = (n: number) => n.toLocaleString("en-US");

export function InfraPanel() {
  const on = useUI((s) => s.settings.infraLayers);
  const toggle = useUI((s) => s.toggleInfraLayer);
  const status = useInfra((s) => s.status);
  const monitor = useInfra((s) => s.monitor);
  const monitorError = useInfra((s) => s.monitorError);
  const [meta, setMeta] = useState<InfraMeta | null>(null);
  useEffect(() => {
    void loadInfraMeta().then(setMeta);
  }, []);

  const flyTo = (lon: number, lat: number, radiusKm: number) => {
    const ui = useUI.getState();
    if (!ui.settings.infraLayers.includes("chokepoints")) ui.toggleInfraLayer("chokepoints");
    ui.requestFlyTo({ lon, lat, zoom: radiusKm > 180 ? 5 : radiusKm > 90 ? 6 : 7 });
  };

  return (
    <div className="glass pointer-events-auto max-h-[calc(100vh-260px)] w-[270px] overflow-y-auto rounded-md px-3 py-2 text-[11px] leading-snug">
      <div className="flex items-center justify-between">
        <div className="meta text-fg">Strategic infrastructure</div>
        <button className="text-muted hover:text-fg" aria-label="Close infrastructure panel" onClick={() => useUI.getState().setInfraOpen(false)}>
          ×
        </button>
      </div>

      <ul className="mt-1.5 space-y-0.5">
        {INFRA_LAYERS.map((l) => {
          const st = status[l.id];
          const active = on.includes(l.id);
          return (
            <li key={l.id}>
              <label className="flex cursor-pointer items-center gap-1.5 text-muted hover:text-fg" title={l.note}>
                <input type="checkbox" checked={active} onChange={() => toggle(l.id)} />
                <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: l.color }} />
                <span className={active ? "text-fg" : ""}>{l.label}</span>
                <span className="ml-auto text-faint tabular-nums">
                  {active && st === "loading" ? "…" : active && st === "error" ? "failed" : typeof st === "number" ? fmt(st) : ""}
                </span>
              </label>
            </li>
          );
        })}
      </ul>

      {on.includes("power") && (
        <div className="mt-2 flex flex-wrap gap-x-2 gap-y-0.5 text-faint">
          {Object.entries(FUEL_COLORS)
            .filter(([f]) => f !== "Nuclear")
            .map(([f, c]) => (
              <span key={f} className="flex items-center gap-1">
                <span className="inline-block h-2 w-2 rounded-full" style={{ background: c }} />
                {f}
              </span>
            ))}
        </div>
      )}
      {on.includes("pipelines") && (
        <div className="mt-1.5 flex flex-wrap gap-x-2 text-faint">
          {Object.entries(PIPELINE_COLORS)
            .filter(([s]) => s !== "unspecified")
            .map(([s, c]) => (
              <span key={s} className="flex items-center gap-1">
                <span className="inline-block h-0.5 w-3" style={{ background: c }} />
                {s === "products" ? "refined products" : s}
              </span>
            ))}
        </div>
      )}

      <div className="mt-3 border-t border-line pt-2">
        <div className="meta" style={{ color: INFRA_LAYERS.find((l) => l.id === "chokepoints")!.color }}>
          Chokepoint monitor · 7 days
        </div>
        {!monitor && <div className="mt-1 text-faint">{monitorError ? `Unavailable: ${monitorError}` : "Loading…"}</div>}
        {monitor && (
          <ul className="mt-1 space-y-0.5">
            {monitor.chokepoints.map((c) => {
              const top = Object.entries(c.byCategory)
                .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
                .slice(0, 2)
                .map(([k, n]) => `${n} ${CATEGORIES[k as EventCategory]?.label.toLowerCase() ?? k}`)
                .join(", ");
              return (
                <li key={c.id}>
                  <button
                    className="flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left hover:bg-panel-hover"
                    title={`${c.connects}. ${c.total} event${c.total === 1 ? "" : "s"} within ${c.radiusKm} km in the last ${monitor.days} days${top ? ` (${top})` : ""}. Disruption score ${c.score}/100. Click to fly there.`}
                    onClick={() => flyTo(c.lon, c.lat, c.radiusKm)}
                  >
                    <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: LEVEL_COLORS[c.level] }} />
                    <span className="truncate text-fg">{c.name}</span>
                    <span className="ml-auto shrink-0 tabular-nums text-muted">{c.total}</span>
                    <span className="w-7 shrink-0 text-right tabular-nums" style={{ color: LEVEL_COLORS[c.level] }}>
                      {c.score}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <div className="mt-1 text-faint">
          Events · score (0–100): WorldView events within each radius, weighted by importance, category and recency (48 h half-life). Not a shipping-traffic measure.
        </div>
      </div>

      <details className="mt-2 border-t border-line pt-2">
        <summary className="meta cursor-pointer text-muted">Sources &amp; licences</summary>
        <ul className="mt-1 space-y-1 text-faint">
          {Object.values(INFRA_DATASETS).map((d) => (
            <li key={d.id}>
              <a className="text-muted underline hover:text-fg" href={d.url} target="_blank" rel="noreferrer">
                {d.name}
              </a>{" "}
              — {d.licence}. {d.attribution}.
              <div>
                Used for:{" "}
                {INFRA_LAYERS.filter((l) => (l.sources as string[]).includes(d.id))
                  .map((l) => l.label)
                  .join(", ")}
              </div>
            </li>
          ))}
        </ul>
        <ul className="mt-1.5 space-y-0.5 text-faint">
          {INFRA_LAYERS.map((l) => (
            <li key={l.id}>
              <span className="text-muted">{l.label}:</span> {l.note}
            </li>
          ))}
        </ul>
        {meta?.builtAt && <div className="mt-1 text-faint">Extract built {meta.builtAt.slice(0, 10)}.</div>}
      </details>
    </div>
  );
}
