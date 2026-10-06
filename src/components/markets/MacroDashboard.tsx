"use client";
/**
 * US macro dashboard (FRED) + crypto Fear & Greed. Changes are shown with
 * neutral ink and an arrow: for macro data "up" is not inherently good or bad.
 */
import { useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import type { MacroDashboard as Dashboard, MacroIndicator } from "@/lib/finance/macro";
import { Sparkline } from "./Sparkline";

const GROUP_ORDER: MacroIndicator["group"][] = ["Inflation", "Jobs", "Growth", "Rates & credit", "Money & liquidity", "Fiscal", "Housing", "Global", "Crypto market", "Sentiment"];

export function formatMacro(v: number | null, unit: MacroIndicator["unit"]): string {
  if (v === null) return "—";
  switch (unit) {
    case "%":
      return `${v.toFixed(1)}%`;
    case "pp":
      return v.toFixed(2);
    case "k":
      return `${Math.round(v).toLocaleString("en-US")}k`;
    case "$T":
      return `$${v.toFixed(2)}T`;
    case "$B":
      // Small balances (e.g. the Fed reverse repo near zero) would otherwise read "$0B".
      return Math.abs(v) < 10 ? `$${v.toFixed(2)}B` : `$${Math.round(v).toLocaleString("en-US")}B`;
    case "ppm":
      return `${v.toFixed(1)} ppm`;
    case "$":
      return `$${v.toFixed(2)}`;
    case "M":
      return `${v.toFixed(1)}M`;
    case "Mkm²":
      return `${v.toFixed(2)}M km²`;
    case "°C":
      return `${v > 0 ? "+" : ""}${v.toFixed(2)}°C`;
    default:
      return Number.isInteger(v) ? String(v) : v.toFixed(1);
  }
}

/** Change rounded to the precision it is shown at, so "−0.0" never appears. */
function roundedDelta(d: number, unit: MacroIndicator["unit"]): number {
  const f = unit === "%" || unit === "ppm" ? 10 : unit === "k" || (unit === "$B" && Math.abs(d) >= 10) ? 1 : 100;
  return Math.round(d * f) / f;
}

function formatDelta(raw: number | null, unit: MacroIndicator["unit"]): string {
  if (raw === null) return "";
  const d = roundedDelta(raw, unit);
  const sign = d > 0 ? "+" : d < 0 ? "−" : "±";
  const a = Math.abs(d);
  const body = unit === "%" ? `${a.toFixed(1)} pt` : unit === "k" ? `${Math.round(a).toLocaleString("en-US")}k` : unit === "$T" ? `$${a.toFixed(2)}T` : unit === "$B" ? (a < 10 ? `$${a.toFixed(2)}B` : `$${Math.round(a).toLocaleString("en-US")}B`) : unit === "ppm" ? `${a.toFixed(1)} ppm` : unit === "$" ? `$${a.toFixed(2)}` : unit === "M" ? `${a.toFixed(1)}M` : unit === "°C" ? `${a.toFixed(2)}°C` : a.toFixed(2);
  return `${sign}${body}`;
}

function asOfLabel(d: string | null): string {
  if (!d) return "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return d; // already a label, e.g. "JAS 2026"
  return new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit", timeZone: "UTC" });
}

/** One indicator tile; generic over the group label so other dashboards can reuse it. */
export function Tile({ m }: { m: Omit<MacroIndicator, "group"> }) {
  const d = m.change === null ? null : roundedDelta(m.change, m.unit);
  const arrow = d === null ? "" : d > 0 ? "▲" : d < 0 ? "▼" : "■";
  return (
    <a
      href={m.sourceUrl}
      target="_blank"
      rel="noreferrer"
      title={`${m.name} — ${m.note}. ${m.source}${m.asOf ? `, as of ${m.asOf}` : ""}${m.changeBasis ? `. Change is ${m.changeBasis}` : ""}.`}
      className="flex items-center justify-between gap-2 rounded border border-line px-2.5 py-1.5 hover:border-line-strong hover:bg-panel-hover"
    >
      <div className="min-w-0">
        <div className="truncate text-[11.5px] text-muted">{m.name}</div>
        <div className="mt-0.5 flex items-baseline gap-1.5">
          <span className="text-[14px] font-medium">{formatMacro(m.value, m.unit)}</span>
          {m.label && <span className="text-[11px] text-muted">{m.label}</span>}
          {m.change !== null && (
            <span className="tabular text-[11px] text-muted">
              {arrow} {formatDelta(m.change, m.unit)}
            </span>
          )}
        </div>
        <div className="text-[10px] text-faint">{asOfLabel(m.asOf)}</div>
      </div>
      <Sparkline values={m.spark} color="var(--text-muted)" width={64} label={`${m.name}, recent history`} />
    </a>
  );
}

/** Grouped grid of tiles. */
export function IndicatorGrid<G extends string>({ indicators, groups }: { indicators: Array<Omit<MacroIndicator, "group"> & { group: G }>; groups: G[] }) {
  return (
    <>
      {groups.map((g) => {
        const rows = indicators.filter((m) => m.group === g);
        if (!rows.length) return null;
        return (
          <div key={g}>
            <div className="mb-1 text-[11px] text-faint">{g}</div>
            <div className="grid grid-cols-3 gap-2">
              {rows.map((m) => (
                <Tile key={m.id} m={m} />
              ))}
            </div>
          </div>
        );
      })}
    </>
  );
}

export function MacroDashboard() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    const ctrl = new AbortController();
    api.macro(ctrl.signal).then(setData).catch((e) => e.name !== "AbortError" && setErr(e.message));
    return () => ctrl.abort();
  }, []);
  if (err) return <p className="text-[12px] text-warn">Macro data unavailable: {err}</p>;
  if (!data) return <p className="text-[12px] text-muted">Loading economic data…</p>;
  if (!data.indicators.length) return <p className="text-[12px] text-faint">Economic data unavailable right now.</p>;
  return (
    <div className="space-y-3">
      <IndicatorGrid indicators={data.indicators} groups={GROUP_ORDER} />
      <p className="text-[10.5px] text-faint">
        Sources: FRED, Federal Reserve Bank of St. Louis (dates are the period each value covers) · U.S. Treasury Fiscal Data · CoinGecko · DefiLlama · alternative.me. Hover a tile for its source.
        Change is versus the previous release. Click a tile for the full series.
      </p>
    </div>
  );
}
