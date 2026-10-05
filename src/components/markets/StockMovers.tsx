"use client";
/** Today's US stock movers (Yahoo screeners, delayed). Click a row for the instrument view. */
import clsx from "clsx";
import { useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import type { ScreenerResult } from "@/lib/finance/screeners";
import { DOWN, UP } from "@/lib/finance/format";
import { useUI } from "@/lib/store/ui";

const TABS = [
  { id: "gainers", label: "Gainers" },
  { id: "losers", label: "Losers" },
  { id: "active", label: "Most active" },
] as const;

const compact = (n: number | null) =>
  n === null ? "—" : n >= 1e12 ? `${(n / 1e12).toFixed(1)}T` : n >= 1e9 ? `${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n.toLocaleString("en-US");

export function StockMovers() {
  const [list, setList] = useState<(typeof TABS)[number]["id"]>("gainers");
  const [data, setData] = useState<ScreenerResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const openInstrument = useUI((s) => s.openInstrument);

  useEffect(() => {
    const ctrl = new AbortController();
    const load = () =>
      api
        .screener(list, ctrl.signal)
        .then((d) => {
          setData(d);
          setErr(null);
        })
        .catch((e) => e.name !== "AbortError" && setErr(e.message));
    load();
    const t = setInterval(load, 5 * 60_000);
    return () => {
      ctrl.abort();
      clearInterval(t);
    };
  }, [list]);

  const rows = data?.list === list ? data.rows : [];
  return (
    <div>
      <div className="mb-1.5 flex gap-1" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={list === t.id}
            onClick={() => setList(t.id)}
            className={clsx("rounded px-2 py-0.5 text-[11.5px]", list === t.id ? "bg-panel-hover text-fg" : "text-muted hover:text-fg")}
          >
            {t.label}
          </button>
        ))}
      </div>
      {err && !rows.length && <p className="text-[12px] text-warn">Unavailable: {err}</p>}
      {!err && !rows.length && <p className="text-[12px] text-muted">Loading…</p>}
      <ul>
        {rows.slice(0, 10).map((r) => {
          const up = (r.changePct ?? 0) >= 0;
          return (
            <li key={r.symbol}>
              <button
                onClick={() => openInstrument(r.symbol)}
                title={`${r.name} · ${r.exchange ?? ""} · volume ${compact(r.volume)} · market cap ${compact(r.marketCap)}`}
                className="grid w-full grid-cols-[56px_1fr_auto_64px] items-center gap-2 rounded px-1 py-[3px] text-left hover:bg-panel-hover"
              >
                <span className="text-[12px] font-medium">{r.symbol}</span>
                <span className="truncate text-[11.5px] text-muted">{r.name}</span>
                <span className="tabular text-[12px]">{r.price?.toFixed(2) ?? "—"}</span>
                <span className="tabular text-right text-[12px]" style={{ color: up ? UP : DOWN }}>
                  {r.changePct === null ? "—" : `${up ? "▲ +" : "▼ "}${r.changePct.toFixed(2)}%`}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {rows.length > 0 && <p className="mt-1 text-[10.5px] text-faint">US stocks, delayed (Yahoo Finance screeners). Big single-day moves often follow earnings or news — not a signal.</p>}
    </div>
  );
}
