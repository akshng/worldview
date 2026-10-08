"use client";
/** Instrument view: which tracked 13F managers hold this stock (latest filings; ticker matched by company name). */
import { useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import type { FundHolder } from "@/lib/finance/thirteenf";
import { SafeLink } from "@/components/ui/primitives";
import { ChangeBadge, quarter, usd } from "./FundHoldings";

type Data = { ticker: string; holders: FundHolder[]; checked: number; total: number; pending: number };

export function HeldByFunds({ symbol }: { symbol: string }) {
  const [data, setData] = useState<Data | null>(null);

  useEffect(() => {
    // Only plain US tickers can appear in 13F filings.
    if (!/^[A-Z]{1,5}([-.][A-Z])?$/.test(symbol)) return;
    const ctrl = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let polls = 0;
    const load = () =>
      api
        .thirteenFByTicker(symbol, ctrl.signal)
        .then((d) => {
          setData(d);
          if (d.pending > 0 && polls++ < 12) timer = setTimeout(load, 10_000);
        })
        .catch(() => {});
    load();
    return () => {
      ctrl.abort();
      clearTimeout(timer);
    };
  }, [symbol]);

  if (!data || data.ticker !== symbol || !data.holders.length) return null;
  const shares = data.holders.filter((h) => !h.putCall);
  if (!shares.length) return null;
  const options = data.holders.length - shares.length;
  return (
    <div className="mb-4">
      <h3 className="meta mb-1 text-faint">Held by tracked funds (13F)</h3>
      <ul>
        {shares.slice(0, 8).map((h) => (
          <li key={`${h.cik}-${h.rank}`} className="grid grid-cols-[1fr_58px_52px_62px] items-center gap-2 py-[2px] text-[12px]">
            <SafeLink href={h.filingUrl} className="truncate hover:text-accent" title={`${h.label} (${quarter(h.period)}): #${h.rank} position, ${h.shares.toLocaleString("en-US")} shares as of ${h.period} (${h.issuer})`}>
              {h.label}
            </SafeLink>
            <span className="tabular text-right">{usd(h.value)}</span>
            <span className="tabular text-right text-muted">{h.weight.toFixed(1)}%</span>
            <span className="tabular text-right text-[11.5px]">
              <ChangeBadge change={h.change} pct={h.sharesChangePct} />
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-0.5 text-[10.5px] leading-snug text-faint">
        Value · % of each fund&apos;s 13F portfolio · share change vs prior quarter, from each fund&apos;s latest 13F (hover for its quarter); 13Fs are filed up to 45 days after quarter end and show long positions only.
        {options > 0 && ` ${options} option position(s) not listed.`}
        {data.pending > 0 && ` Checked ${data.checked} of ${data.total} funds so far.`} Ticker matched by company name. Not investment advice.
      </p>
    </div>
  );
}
