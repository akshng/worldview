"use client";
/** Instrument view: open-market insider buys and sells from SEC Form 4 (last 90 days). */
import { useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import type { InsiderSummary } from "@/lib/finance/insiders";
import { SafeLink } from "@/components/ui/primitives";

const usd = (v: number) => (v >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `$${Math.round(v / 1e3)}K` : `$${Math.round(v)}`);

export function InsiderTrades({ symbol }: { symbol: string }) {
  const [data, setData] = useState<InsiderSummary | null>(null);

  useEffect(() => {
    if (!/^[A-Z]{1,5}([-.][A-Z])?$/.test(symbol)) return;
    const ctrl = new AbortController();
    api.insiders(symbol, ctrl.signal).then(setData).catch(() => {});
    return () => ctrl.abort();
  }, [symbol]);

  if (!data || data.ticker !== symbol) return null;
  return (
    <div className="mb-4">
      <h3 className="meta mb-1 text-faint">Insider trades (SEC Form 4, 90 days)</h3>
      <p className="mb-1 text-[12px]">
        <span className={data.buyers ? "text-accent" : "text-muted"}>
          {data.buyers} buying{data.buyValue ? ` · ${usd(data.buyValue)}` : ""}
        </span>
        <span className="text-faint"> · </span>
        <span className="text-muted">
          {data.sellers} selling{data.sellValue ? ` · ${usd(data.sellValue)}` : ""}
        </span>
        {data.clusterBuy && <span className="ml-2 rounded border border-line px-1 text-[11px]">Several insiders buying</span>}
      </p>
      {data.trades.length > 0 ? (
        <ul>
          {data.trades.slice(0, 8).map((t, i) => (
            <li key={i} className="grid grid-cols-[66px_1fr_44px_64px] items-center gap-2 py-[2px] text-[12px]">
              <span className="tabular text-muted">{t.date.slice(5)}</span>
              <SafeLink href={t.filingUrl} className="truncate hover:text-accent" title={`${t.owner}, ${t.role}: ${t.code === "P" ? "bought" : "sold"} ${t.shares.toLocaleString("en-US")} shares${t.price ? ` at $${t.price.toFixed(2)}` : ""} (filed ${t.filed})`}>
                {t.owner} <span className="text-faint">· {t.role}</span>
              </SafeLink>
              <span className={`text-right ${t.code === "P" ? "text-accent" : "text-muted"}`}>{t.code === "P" ? "Buy" : "Sell"}</span>
              <span className="tabular text-right">{t.value ? usd(t.value) : "—"}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[12px] text-faint">No open-market buys or sells reported.</p>
      )}
      <p className="mt-0.5 text-[10.5px] leading-snug text-faint">Open-market trades only (grants, option exercises and gifts left out). Sales are often routine: taxes, diversification or pre-planned 10b5-1 sales. Not investment advice.</p>
    </div>
  );
}
