"use client";
/** Top 20 cryptocurrencies by market cap (CoinGecko). Changes carry arrow + colour, never colour alone. */
import { useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import type { CryptoMarkets } from "@/lib/finance/crypto";
import { DOWN, UP } from "@/lib/finance/format";
import { Sparkline } from "./Sparkline";

const usd = (v: number | null) =>
  v === null ? "—" : v >= 1000 ? v.toLocaleString("en-US", { maximumFractionDigits: 0 }) : v >= 1 ? v.toFixed(2) : v.toPrecision(3);
const big = (v: number | null) => (v === null ? "—" : v >= 1e12 ? `$${(v / 1e12).toFixed(2)}T` : v >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : `$${(v / 1e6).toFixed(0)}M`);

function Change({ v }: { v: number | null }) {
  if (v === null) return <span className="text-faint">—</span>;
  const up = v >= 0;
  return (
    <span className="tabular" style={{ color: up ? UP : DOWN }}>
      {up ? "▲ +" : "▼ "}
      {v.toFixed(1)}%
    </span>
  );
}

export function CryptoTable() {
  const [data, setData] = useState<CryptoMarkets | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    const ctrl = new AbortController();
    api.crypto(ctrl.signal).then(setData).catch((e) => e.name !== "AbortError" && setErr(e.message));
    return () => ctrl.abort();
  }, []);
  if (err) return <p className="text-[12px] text-warn">Crypto table unavailable: {err}</p>;
  if (!data) return <p className="text-[12px] text-muted">Loading…</p>;
  return (
    <div>
      <table className="w-full text-[12px]">
        <thead>
          <tr className="text-left text-[10.5px] text-faint">
            <th className="py-1 pr-2 font-normal">#</th>
            <th className="py-1 pr-2 font-normal">Coin</th>
            <th className="py-1 pr-2 text-right font-normal">Price (USD)</th>
            <th className="py-1 pr-2 text-right font-normal">24h</th>
            <th className="py-1 pr-2 text-right font-normal">7d</th>
            <th className="py-1 pr-2 text-right font-normal">Market cap</th>
            <th className="py-1 font-normal">7 days</th>
          </tr>
        </thead>
        <tbody>
          {data.rows.map((r) => (
            <tr key={r.id} className="border-t border-line">
              <td className="py-1 pr-2 text-faint">{r.rank}</td>
              <td className="py-1 pr-2">
                <span className="font-medium">{r.symbol}</span> <span className="text-muted">{r.name}</span>
              </td>
              <td className="tabular py-1 pr-2 text-right">{usd(r.price)}</td>
              <td className="py-1 pr-2 text-right"><Change v={r.change24h} /></td>
              <td className="py-1 pr-2 text-right"><Change v={r.change7d} /></td>
              <td className="tabular py-1 pr-2 text-right text-muted">{big(r.marketCap)}</td>
              <td className="py-1">
                <Sparkline values={r.spark} width={72} height={18} color={(r.change7d ?? 0) >= 0 ? UP : DOWN} label={`${r.name}, last 7 days`} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-1 text-[10.5px] text-faint">Source: CoinGecko (aggregated across exchanges; refreshed every 5 minutes). Stablecoins are included as they rank.</p>
    </div>
  );
}
