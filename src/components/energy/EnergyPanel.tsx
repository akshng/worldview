"use client";
/** Energy: live electricity-grid data (GB, Spain, France, Germany, Australia NEM) from official open sources. */
import { useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import type { EnergyDashboard, FuelKey, GenerationMix, Grid, Metric } from "@/lib/energy";
import { useUI } from "@/lib/store/ui";
import { formatUtc, relativeTime } from "@/lib/time";
import { CloseIcon } from "@/components/ui/icons";

/** Fixed fuel colours (same fuel, same colour on every card). Always shown next to a text label. */
const FUEL_COLOR: Record<FuelKey, string> = {
  wind: "#38bdf8",
  solar: "#facc15",
  hydro: "#2563eb",
  bio: "#4ade80",
  otherRenewable: "#a3e635",
  nuclear: "#a78bfa",
  gas: "#f97316",
  coal: "#78716c",
  oil: "#b45309",
  otherFossil: "#d6d3d1",
  storage: "#ec4899",
  imports: "#94a3b8",
  other: "#475569",
};

/** Time label: UTC ISO timestamp → "2026-10-07 05:30 UTC"; plain day → "2026-10-06 (day)". */
function when(asOf: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(asOf) ? `${asOf} (day)` : formatUtc(asOf);
}

function fmt(m: Metric): string {
  if (m.unit === "MW") return m.value >= 10_000 ? `${(m.value / 1000).toFixed(1)} GW` : `${m.value.toLocaleString("en-US")} MW`;
  if (m.unit === "%") return `${m.value.toFixed(1)}%`;
  if (m.unit.endsWith("/MWh") && m.unit !== "gCO₂/kWh") {
    const cur = m.unit.replace("/MWh", "");
    return `${cur}${m.value.toFixed(2)}`;
  }
  return `${m.value}`;
}

function unitLabel(m: Metric): string {
  if (m.unit === "MW" || m.unit === "%") return "";
  if (m.unit.endsWith("/MWh")) return "/MWh";
  return m.unit;
}

function Stat({ label, metric, missingText }: { label: string; metric: Metric | null; missingText: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[10.5px] text-faint">{label}</div>
      {metric ? (
        <div title={`${metric.note ? metric.note + " · " : ""}${when(metric.asOf)}`}>
          <span className="tabular text-[17px] font-semibold">{fmt(metric)}</span>
          <span className="ml-1 text-[11px] text-muted">{unitLabel(metric)}</span>
          {metric.note && <div className="truncate text-[10px] text-faint">{metric.note}</div>}
        </div>
      ) : (
        <div className="text-[12px] text-faint">{missingText}</div>
      )}
    </div>
  );
}

function MixBar({ mix }: { mix: GenerationMix }) {
  return (
    <div>
      <div className="mb-1 flex justify-between text-[10.5px] text-faint">
        <span>Generation mix · {mix.basis}</span>
        <span className="tabular">{when(mix.asOf)}</span>
      </div>
      <div className="flex h-5 w-full overflow-hidden rounded" role="img" aria-label={`Generation mix: ${mix.fuels.map((f) => `${f.label} ${f.share}%`).join(", ")}`}>
        {mix.fuels.map((f) => (
          <div
            key={f.fuel}
            className="flex items-center justify-center overflow-hidden text-[9.5px] font-medium text-black/80"
            style={{ width: `${f.share}%`, background: FUEL_COLOR[f.fuel] }}
            title={`${f.label}: ${f.share}%${f.value != null ? ` (${f.value.toLocaleString("en-US")} ${mix.unit})` : ""}`}
          >
            {f.share >= 12 ? f.label : ""}
          </div>
        ))}
      </div>
      <ul className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px]">
        {mix.fuels.map((f) => (
          <li key={f.fuel} className="flex items-center gap-1">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: FUEL_COLOR[f.fuel] }} aria-hidden />
            <span className="text-muted">{f.label}</span>
            <span className="tabular">{f.share}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function GridCard({ grid }: { grid: Grid }) {
  const na = (part: string) => (grid.missing.includes(part) ? "Not available" : "—");
  return (
    <section className="rounded-md border border-line p-4">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h3 className="text-[14px] font-semibold">
          {grid.name}
          {grid.stale && <span className="ml-2 text-[10.5px] font-normal text-warn">showing last good data</span>}
        </h3>
        <a className="truncate text-[10.5px] text-faint hover:text-accent" href={grid.sourceUrl} target="_blank" rel="noreferrer">
          {grid.source}
        </a>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Demand" metric={grid.demand} missingText={na("demand")} />
        <Stat label="Renewable share" metric={grid.renewableShare} missingText={grid.mix ? "—" : "Not available"} />
        <Stat label="Carbon intensity" metric={grid.carbonIntensity} missingText={na("carbon intensity")} />
        <Stat label="Wholesale price" metric={grid.price} missingText={na("price")} />
      </div>
      {grid.mix && (
        <div className="mt-3">
          <MixBar mix={grid.mix} />
        </div>
      )}
      {grid.regions && grid.regions.length > 0 && (
        <table className="mt-3 w-full text-[12px]">
          <thead>
            <tr className="text-left text-[10.5px] text-faint">
              <th className="py-1 font-normal">Region</th>
              <th className="py-1 text-right font-normal">Demand</th>
              <th className="py-1 text-right font-normal">Price ({grid.price?.unit ?? "/MWh"})</th>
            </tr>
          </thead>
          <tbody>
            {grid.regions.map((r) => (
              <tr key={r.id} className="border-t border-line">
                <td className="py-1">{r.name}</td>
                <td className="tabular py-1 text-right text-muted">{r.demandMw != null ? `${r.demandMw.toLocaleString("en-US")} MW` : "—"}</td>
                <td className="tabular py-1 text-right">{r.price != null ? r.price.toFixed(2) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {(grid.notes?.length ?? 0) > 0 && <p className="mt-2 text-[10.5px] text-faint">{grid.notes!.join(" ")}</p>}
    </section>
  );
}

export function EnergyPanel() {
  const open = useUI((s) => s.energyOpen);
  const setOpen = useUI((s) => s.setEnergyOpen);
  const [data, setData] = useState<EnergyDashboard | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const ctrl = new AbortController();
    api.energy(ctrl.signal).then(setData).catch((e) => e.name !== "AbortError" && setErr(e.message));
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => {
      ctrl.abort();
      window.removeEventListener("keydown", onKey);
    };
  }, [open, setOpen]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-center overflow-y-auto bg-black/60 px-4 py-8" onMouseDown={() => setOpen(false)}>
      <div className="glass h-fit w-[820px] max-w-full rounded-lg shadow-2xl shadow-black/60" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Energy">
        <div className="flex items-start justify-between gap-4 border-b border-line px-6 pt-5 pb-4">
          <div>
            <div className="meta text-accent">Energy</div>
            <h2 className="mt-1 text-[20px] leading-tight font-semibold tracking-tight">Electricity grids</h2>
            <p className="mt-1 text-[12px] text-muted">
              Live demand, generation mix, carbon intensity and wholesale prices from grid operators and regulators.{data && ` Updated ${relativeTime(data.generatedAt)}.`} All
              times UTC; hover a value for its exact timestamp.
            </p>
          </div>
          <button onClick={() => setOpen(false)} className="shrink-0 rounded-md p-1.5 text-muted hover:bg-panel-hover hover:text-fg" title="Close (Esc)" aria-label="Close energy panel">
            <CloseIcon />
          </button>
        </div>
        <div className="space-y-3 px-6 py-5">
          {err && <p className="text-[12px] text-danger">{err}</p>}
          {!data && !err && <p className="text-[12px] text-muted">Loading…</p>}
          {data?.grids.map((g) => <GridCard key={g.id} grid={g} />)}
          {data && data.failed.length > 0 && <p className="text-[11px] text-warn">Unavailable right now: {data.failed.join(", ")}</p>}
          <p className="text-[10.5px] text-faint">
            Sources: NESO Carbon Intensity API and Elexon Insights (GB), Red Eléctrica REData (Spain), RTE éCO2mix via ODRE (France), Bundesnetzagentur SMARD (Germany), AEMO
            (Australia). Renewable share is computed from each source&apos;s generation mix. Prices are wholesale, not retail. Information only.
          </p>
        </div>
      </div>
    </div>
  );
}
