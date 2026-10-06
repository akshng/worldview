"use client";
/**
 * Futures term structure: one curve at a time (prices of successive contract
 * months, or VIX constant-maturity indices). Slope is shown in neutral ink with an
 * arrow — contango or backwardation is a description, not a signal.
 */
import clsx from "clsx";
import { useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import type { TermStructure as Data } from "@/lib/finance/term-structure";
import { LineChart } from "@/components/charts/LineChart";
import { relativeTime } from "@/lib/time";

const SHAPE: Record<string, string> = {
  contango: "Upward-sloping (contango): later months cost more",
  backwardation: "Downward-sloping (backwardation): nearby months cost more",
  flat: "Roughly flat (within ±1%)",
};

export function TermStructure() {
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sel, setSel] = useState("CL");
  useEffect(() => {
    api.termStructure().then(setData).catch((e) => setErr(e.message));
  }, []);
  if (err) return <p className="text-[12px] text-warn">Term structure unavailable: {err}</p>;
  if (!data) return <div className="h-[200px] animate-pulse rounded bg-white/[0.03]" />;
  if (!data.curves.length) return <p className="text-[12px] text-faint">No futures curves available right now.</p>;
  const c = data.curves.find((x) => x.id === sel) ?? data.curves[0];
  const fmt = (y: number) => (c.unit === "index" ? y.toFixed(1) : y >= 1000 ? y.toLocaleString("en-US", { maximumFractionDigits: 0 }) : y.toFixed(2));
  const asOf = c.points.map((p) => p.asOf).filter(Boolean).sort().at(-1);
  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-1">
        {data.curves.map((x) => (
          <button key={x.id} onClick={() => setSel(x.id)} className={clsx("meta rounded px-2 py-0.5", x.id === c.id ? "bg-accent-soft text-accent" : "text-faint hover:text-fg")}>
            {x.id === "VIX" ? "VIX" : x.name.replace(/ \(.*\)$/, "")}
          </button>
        ))}
      </div>
      <LineChart
        series={[{ name: c.name, color: "var(--accent)", points: c.points.map((p) => [p.x, p.price]) }]}
        height={180}
        xTicks={c.points.filter((_, i) => i % Math.ceil(c.points.length / 6) === 0).map((p) => p.x)}
        formatX={(x) => c.points.find((p) => p.x === Math.round(x))?.label ?? ""}
        formatY={fmt}
        ariaLabel={`${c.name} term structure: ${c.points.map((p) => `${p.label} ${fmt(p.price)}`).join(", ")}`}
      />
      {c.shape && c.slopePct !== null && (
        <p className="mt-1 text-[12px]">
          <span className="tabular">
            {c.slopePct > 0 ? "▲ +" : c.slopePct < 0 ? "▼ " : "■ "}
            {c.slopePct.toFixed(1)}%
          </span>{" "}
          <span className="text-muted">
            {c.points[0].label} → {c.points[c.points.length - 1].label}. {SHAPE[c.shape]}.
          </span>
        </p>
      )}
      <p className="mt-1 text-[10.5px] text-faint">
        {c.kind === "indices"
          ? "Cboe VIX indices at fixed horizons (9 days to 1 year) — not VIX futures prices."
          : `Successive contract months, ${c.unit}.`}{" "}
        Yahoo Finance (unofficial, delayed){asOf ? `, ${relativeTime(asOf)}` : ""}. Information only — not investment advice.
      </p>
    </div>
  );
}
