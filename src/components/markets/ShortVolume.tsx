"use client";
/** FINRA daily short sale volume for a US-listed symbol (last 10 sessions). */
import { useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import type { ShortVolume as Data } from "@/lib/finance/short-volume";

export function ShortVolume({ symbol }: { symbol: string }) {
  const [data, setData] = useState<Data | null>(null);
  useEffect(() => {
    const ctrl = new AbortController();
    api.shortVolume(symbol, ctrl.signal).then(setData).catch(() => {});
    return () => ctrl.abort();
  }, [symbol]);
  if (!data || data.symbol !== symbol || !data.days.length) return null;
  const avg = data.days.reduce((s, d) => s + d.shortPct, 0) / data.days.length;
  return (
    <div className="mb-4">
      <h3 className="meta mb-1 text-faint">Short sale volume (FINRA, daily)</h3>
      <div className="flex h-10 items-end gap-[3px]" role="img" aria-label={`Short volume share, last ${data.days.length} sessions, averaging ${avg.toFixed(1)}%`}>
        {data.days.map((d) => (
          <div key={d.date} className="flex-1 rounded-t-[2px] bg-white/25 hover:bg-white/45" style={{ height: `${Math.max(4, d.shortPct)}%` }} title={`${d.date}: ${d.shortPct}% short (${d.shortVolume.toLocaleString("en-US")} of ${d.totalVolume.toLocaleString("en-US")} shares)`} />
        ))}
      </div>
      <div className="mt-1 text-[12px]">
        Latest <span className="tabular">{data.days[data.days.length - 1].shortPct}%</span> · {data.days.length}-day average <span className="tabular">{avg.toFixed(1)}%</span>
      </div>
      <p className="mt-0.5 text-[10.5px] leading-snug text-faint">{data.note}</p>
    </div>
  );
}
