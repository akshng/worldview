"use client";
/**
 * Speculators' net futures positioning (CFTC COT). Diverging bars of net % of open
 * interest; arrow + sign carry direction so colour is never the only cue.
 */
import { useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import type { CotReport } from "@/lib/finance/cot";
import { DOWN, UP } from "@/lib/finance/format";
import { Sparkline } from "./Sparkline";

const fmt = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toLocaleString("en-US")}`;

export function Positioning() {
  const [data, setData] = useState<CotReport | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    const ctrl = new AbortController();
    api.positioning(ctrl.signal).then(setData).catch((e) => e.name !== "AbortError" && setErr(e.message));
    return () => ctrl.abort();
  }, []);
  if (err) return <p className="text-[12px] text-warn">Positioning unavailable: {err}</p>;
  if (!data) return <p className="text-[12px] text-muted">Loading…</p>;
  const max = Math.max(10, ...data.rows.map((r) => Math.abs(r.netPctOi)));
  const groups = [...new Set(data.rows.map((r) => r.group))];
  return (
    <div>
      <div className="mb-1 grid grid-cols-[150px_1fr_86px_60px_64px] gap-2 text-[10.5px] text-faint">
        <span>Market</span>
        <span className="text-center">Net speculative position, % of open interest</span>
        <span className="text-right">Net contracts</span>
        <span className="text-right" title="Where this week's net position sits in its own 3-year range: 0 = most short, 100 = most long">3-yr pctile</span>
        <span>1 year</span>
      </div>
      {groups.map((g) => (
        <div key={g} className="mb-1.5">
          <div className="text-[11px] text-faint">{g}</div>
          {data.rows.filter((r) => r.group === g).map((r) => {
            const w = (Math.abs(r.netPctOi) / max) * 50;
            const long = r.netPctOi >= 0;
            return (
              <div
                key={r.code}
                className="grid grid-cols-[150px_1fr_86px_60px_64px] items-center gap-2 py-[2px]"
                title={`${r.name}: speculators net ${long ? "long" : "short"} ${Math.abs(r.netSpec).toLocaleString("en-US")} contracts (${r.netPctOi}% of ${r.openInterest.toLocaleString("en-US")} open interest)${r.netChange !== null ? `, ${fmt(r.netChange)} vs prior week` : ""}. Report date ${r.reportDate}.`}
              >
                <span className="truncate text-[12px] text-muted">{r.name}</span>
                <span className="relative h-3">
                  <span className="absolute inset-y-0 left-1/2 w-px bg-white/15" />
                  <span className="absolute inset-y-0 rounded-[2px]" style={{ background: long ? UP : DOWN, left: long ? "50%" : `${50 - w}%`, width: `${w}%` }} />
                </span>
                <span className="tabular text-right text-[12px]">
                  {long ? "▲" : "▼"} {fmt(r.netSpec)}
                </span>
                <span className="tabular text-right text-[12px] text-muted">{r.percentile3y ?? "—"}</span>
                <Sparkline values={r.history} width={64} height={18} color={long ? UP : DOWN} label={`${r.name} net position, last year`} />
              </div>
            );
          })}
        </div>
      ))}
      <p className="mt-1 text-[10.5px] text-faint">
        CFTC Commitments of Traders, legacy futures-only report. Speculators = non-commercial traders. Positions as of {data.reportDate ?? "—"} (Tuesday),
        published the following Friday. Extreme readings show crowded positioning — not a forecast.
      </p>
    </div>
  );
}
