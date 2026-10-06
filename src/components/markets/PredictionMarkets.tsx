"use client";
/** Prediction-market implied probabilities (Kalshi), grouped by topic. Not a forecast. */
import clsx from "clsx";
import { useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import type { PmGroup, PredictionMarkets as Data } from "@/lib/finance/prediction-markets";

const TABS: Array<{ id: PmGroup; label: string }> = [
  { id: "economics", label: "Economics" },
  { id: "financials", label: "Financials" },
  { id: "politics", label: "Politics" },
  { id: "world", label: "World & science" },
];

export function PredictionMarkets() {
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<PmGroup>("economics");
  useEffect(() => {
    const ctrl = new AbortController();
    api.predictions(ctrl.signal).then(setData).catch((e) => e.name !== "AbortError" && setErr(e.message));
    return () => ctrl.abort();
  }, []);
  if (err) return <p className="text-[12px] text-warn">Prediction markets unavailable: {err}</p>;
  if (!data) return <p className="text-[12px] text-muted">Loading…</p>;
  const events = data.events.filter((e) => e.group === tab);
  return (
    <div>
      <div className="mb-1.5 flex gap-1" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)} className={clsx("rounded px-2 py-0.5 text-[11.5px]", tab === t.id ? "bg-panel-hover text-fg" : "text-muted hover:text-fg")}>
            {t.label}
          </button>
        ))}
      </div>
      {!events.length && <p className="text-[12px] text-faint">No active markets in this group.</p>}
      <ul className="grid grid-cols-2 gap-x-5">
        {events.map((e) => (
          <li key={e.ticker} className="border-b border-line py-1.5">
            <a href={e.url} target="_blank" rel="noreferrer" className="line-clamp-1 text-[12.5px] hover:text-accent" title={`${e.title} · $${e.volume24h.toLocaleString("en-US")} traded in 24 h`}>
              {e.title}
            </a>
            <div className="mt-0.5 space-y-[2px]">
              {e.outcomes.map((o) => (
                <div key={o.label} className="grid grid-cols-[1fr_44px_52px] items-center gap-2 text-[11.5px]">
                  <span className="truncate text-muted">{o.label}</span>
                  <span className="tabular text-right">{o.prob !== null ? `${Math.round(o.prob * 100)}%` : "—"}</span>
                  <span className="tabular text-right text-faint">{o.change ? `${o.change > 0 ? "▲ +" : "▼ "}${Math.round(o.change * 100)} pt` : ""}</span>
                </div>
              ))}
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-1 text-[10.5px] text-faint">
        Kalshi (CFTC-regulated exchange) public market data. Percentages are last traded prices — market-implied probabilities, not forecasts. Change is vs the previous day. Sports and entertainment excluded.
      </p>
    </div>
  );
}
