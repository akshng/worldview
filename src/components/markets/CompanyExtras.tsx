"use client";
/** Instrument view extras: dividend history, balance sheet and quarterly revenue (SEC XBRL). */
import { useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import type { Dividends as DividendData } from "@/lib/finance/dividends";
import type { BalanceItem, QuarterValue } from "@/lib/finance/company";

export const compact = (v: number, money = true) => {
  const a = Math.abs(v);
  const s = a >= 1e12 ? `${(v / 1e12).toFixed(2)}T` : a >= 1e9 ? `${(v / 1e9).toFixed(2)}B` : a >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v.toLocaleString("en-US");
  return money ? `${v < 0 ? "−" : ""}$${s.replace(/^-/, "")}` : s;
};

/** Ex-dividend history with trailing-12-month total and yield. Renders nothing for non-payers. */
export function Dividends({ symbol }: { symbol: string }) {
  const [data, setData] = useState<DividendData | null>(null);
  useEffect(() => {
    const ctrl = new AbortController();
    api.dividends(symbol, ctrl.signal).then(setData).catch(() => {});
    return () => ctrl.abort();
  }, [symbol]);
  if (!data || data.symbol !== symbol || !data.payments.length) return null;
  const recent = data.payments.slice(-20);
  const max = Math.max(...recent.map((p) => p.amount));
  const last = data.payments[data.payments.length - 1];
  const cur = data.currency ? ` ${data.currency}` : "";
  return (
    <div className="mb-4">
      <h3 className="meta mb-1 text-faint">Dividends (ex-dates, per share)</h3>
      <div className="flex h-10 items-end gap-[3px]" role="img" aria-label={`Last ${recent.length} dividends, latest ${last.amount}${cur} on ${last.exDate}`}>
        {recent.map((p) => (
          <div key={p.exDate} className="flex-1 rounded-t-[2px] bg-white/25 hover:bg-white/45" style={{ height: `${Math.max(6, (p.amount / max) * 100)}%` }} title={`${p.exDate}: ${p.amount}${cur}`} />
        ))}
      </div>
      <dl className="mt-1 grid grid-cols-3 gap-2 text-[12px]">
        <div>
          <dt className="meta text-faint">Latest</dt>
          <dd className="tabular">{last.amount}{cur} <span className="text-faint">{last.exDate}</span></dd>
        </div>
        <div>
          <dt className="meta text-faint">Trailing 12 mo</dt>
          <dd className="tabular">{data.ttm !== null ? `${data.ttm}${cur}` : "—"}{data.perYear ? <span className="text-faint"> · {data.perYear}×/yr</span> : null}</dd>
        </div>
        <div>
          <dt className="meta text-faint">Trailing yield</dt>
          <dd className="tabular">{data.yieldPct !== null ? `${data.yieldPct.toFixed(2)}%` : "—"}</dd>
        </div>
      </dl>
      <p className="mt-0.5 text-[10.5px] leading-snug text-faint">Past payments only; trailing yield = last 12 months&apos; dividends ÷ current price. Yahoo Finance (unofficial, delayed). Not a forecast.</p>
    </div>
  );
}

export function BalanceSheet({ items }: { items: BalanceItem[] }) {
  if (!items.length) return null;
  return (
    <>
      <h4 className="meta mt-3 mb-1 text-faint">Balance sheet (latest filing)</h4>
      <dl className="grid grid-cols-3 gap-x-3 gap-y-1.5 text-[12px]">
        {items.map((b) => (
          <div key={b.label} title={`As of ${b.asOf} (${b.form})`}>
            <dt className="meta text-faint normal-case tracking-normal">{b.label}</dt>
            <dd className="tabular">{compact(b.value, b.unit === "USD")}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-0.5 text-[10.5px] text-faint">As of {[...new Set(items.map((b) => b.asOf))].sort().at(-1)}; hover for each item&apos;s date.</p>
    </>
  );
}

/** Quarterly revenue bars in neutral ink (revenue level isn't good/bad), labelled by quarter end. */
export function RevenueHistory({ quarters }: { quarters: QuarterValue[] }) {
  if (quarters.length < 3) return null;
  const max = Math.max(...quarters.map((q) => q.value), 1);
  const first = quarters[0], last = quarters[quarters.length - 1];
  return (
    <>
      <h4 className="meta mt-3 mb-1 text-faint">Quarterly revenue · last {quarters.length} quarters</h4>
      <div className="flex h-12 items-end gap-[3px]" role="img" aria-label={`Quarterly revenue from ${compact(first.value)} (quarter ending ${first.end}) to ${compact(last.value)} (quarter ending ${last.end})`}>
        {quarters.map((q) => (
          <div
            key={q.end}
            className={q.derived ? "flex-1 rounded-t-[2px] border border-dashed border-white/40 bg-white/10 hover:bg-white/30" : "flex-1 rounded-t-[2px] bg-white/25 hover:bg-white/45"}
            style={{ height: `${Math.max(4, (Math.max(0, q.value) / max) * 100)}%` }}
            title={`Quarter ending ${q.end}: ${compact(q.value)}${q.derived ? " (derived: annual total − three reported quarters)" : ""}`}
          />
        ))}
      </div>
      <div className="mt-0.5 flex justify-between text-[10.5px] text-faint">
        <span>{first.end.slice(0, 7)}</span>
        <span className="tabular text-muted">Latest {compact(last.value)}</span>
        <span>{last.end.slice(0, 7)}</span>
      </div>
      {quarters.some((q) => q.derived) && <p className="text-[10.5px] text-faint">Dashed bars: fourth quarters derived from the annual report.</p>}
    </>
  );
}
