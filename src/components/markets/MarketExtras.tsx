"use client";
/** Sector performance bars, Treasury yield curve and the economic calendar. */
import { useEffect, useState } from "react";
import { api, type CalendarItem, type Quote, type YieldCurveResponse } from "@/lib/client/api";
import { DOWN, UP } from "@/lib/finance/format";
import { LineChart } from "@/components/charts/LineChart";
import { useUI } from "@/lib/store/ui";
import { useNow } from "@/lib/client/use-now";

/** Diverging bars sorted by daily % change; value labels in text ink, bars carry direction. */
export function SectorBars({ sectors }: { sectors: Quote[] }) {
  const rows = sectors.filter((q) => q.changePct !== null).sort((a, b) => (b.changePct ?? 0) - (a.changePct ?? 0));
  const max = Math.max(0.5, ...rows.map((q) => Math.abs(q.changePct ?? 0)));
  const openInstrument = useUI((s) => s.openInstrument);
  if (!rows.length) return <p className="text-[12px] text-faint">Sector data unavailable.</p>;
  return (
    <ul className="space-y-[3px]">
      {rows.map((q) => {
        const v = q.changePct!;
        const w = (Math.abs(v) / max) * 50;
        return (
          <li key={q.symbol}>
            <button onClick={() => openInstrument(q.symbol)} className="group grid w-full grid-cols-[150px_1fr_64px] items-center gap-2 rounded px-1 py-[2px] text-left hover:bg-panel-hover" title={`${q.symbol} — ${q.name}`}>
              <span className="truncate text-[12px] text-muted group-hover:text-fg">{q.name}</span>
              <span className="relative h-3">
                <span className="absolute inset-y-0 left-1/2 w-px bg-white/15" />
                <span
                  className="absolute inset-y-0 rounded-[2px]"
                  style={{ background: v >= 0 ? UP : DOWN, left: v >= 0 ? "50%" : `${50 - w}%`, width: `${w}%` }}
                />
              </span>
              <span className="tabular text-right text-[12px]">{v >= 0 ? "▲ +" : "▼ "}{v.toFixed(2)}%</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

const TENOR_YEARS: Record<string, number> = { "1 Mo": 1 / 12, "2 Mo": 2 / 12, "3 Mo": 0.25, "6 Mo": 0.5, "1 Yr": 1, "2 Yr": 2, "3 Yr": 3, "5 Yr": 5, "7 Yr": 7, "10 Yr": 10, "20 Yr": 20, "30 Yr": 30 };
const TENOR_ORDER = Object.keys(TENOR_YEARS);

export function YieldCurve() {
  const [curve, setCurve] = useState<YieldCurveResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    api.yieldCurve().then(setCurve).catch((e) => setErr(e.message));
  }, []);
  if (err) return <p className="text-[12px] text-warn">Yield curve unavailable: {err}</p>;
  if (!curve) return <div className="h-[180px] animate-pulse rounded bg-white/[0.03]" />;
  // x = tenor index (even spacing reads better than a log/linear year scale here)
  const pts = (ys: YieldCurveResponse["latest"]["yields"]) =>
    ys.filter((y) => y.value !== null).map((y) => [TENOR_ORDER.indexOf(y.tenor), y.value!] as [number, number]);
  const series = [{ name: curve.latest.date, color: "#3f8de8", points: pts(curve.latest.yields) }];
  if (curve.monthAgo) series.push({ name: curve.monthAgo.date, color: "#8a94a3", points: pts(curve.monthAgo.yields), dashed: true } as never);
  return (
    <LineChart
      series={series}
      height={190}
      xTicks={[0, 2, 4, 5, 7, 9, 11]}
      formatX={(x) => TENOR_ORDER[Math.round(x)]?.replace(" ", "") ?? ""}
      formatY={(y) => `${y.toFixed(2)}%`}
      ariaLabel="US Treasury par yield curve, latest vs one month earlier"
    />
  );
}

export function EconomicCalendar() {
  const [items, setItems] = useState<CalendarItem[] | null>(null);
  const [showAll, setShowAll] = useState(false);
  const now = useNow(60_000);
  useEffect(() => {
    api.calendar().then((r) => setItems(r.items)).catch(() => setItems([]));
  }, []);
  if (!items) return <div className="h-24 animate-pulse rounded bg-white/[0.03]" />;
  const list = items.filter((i) => showAll || i.importance !== "low").filter((i) => Date.parse(i.at) >= now - 86_400_000).slice(0, 14);
  return (
    <div>
      <ul className="space-y-0.5">
        {list.map((i) => {
          const t = new Date(i.at);
          const past = t.getTime() < now;
          return (
            <li key={i.id} className={past ? "opacity-50" : ""}>
              <a href={i.url} target="_blank" rel="noopener noreferrer" className="grid grid-cols-[92px_1fr_auto] items-baseline gap-2 rounded px-1 py-[3px] text-[12px] hover:bg-panel-hover">
                <span className="tabular text-muted">{t.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })} {t.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                <span className="truncate">
                  {i.importance === "high" && <span className="meta mr-1.5 rounded-sm border border-warn/40 px-1 text-warn">Key</span>}
                  {i.title}
                  {i.detail && <span className="text-faint"> · {i.detail}</span>}
                </span>
                <span className="meta text-faint">{i.agency}</span>
              </a>
            </li>
          );
        })}
        {!list.length && <li className="text-[12px] text-faint">No scheduled releases in the next two weeks.</li>}
      </ul>
      <button onClick={() => setShowAll((v) => !v)} className="meta mt-1 text-faint hover:text-fg">{showAll ? "Key & medium only" : "Show all incl. bill auctions"}</button>
      <p className="mt-1 text-[10.5px] text-faint">Scheduled dates from BLS, BEA and the U.S. Treasury, in your local time. No forecasts.</p>
    </div>
  );
}

/** Recent U.S. Treasury auction results. */
export function TreasuryAuctions() {
  const [rows, setRows] = useState<import("@/lib/finance/auctions").AuctionResult[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    api.auctions().then((r) => setRows(r.auctions)).catch((e) => setErr(e.message));
  }, []);
  if (err) return <p className="text-[12px] text-warn">Auction results unavailable: {err}</p>;
  if (!rows) return <p className="text-[12px] text-muted">Loading…</p>;
  return (
    <div>
      <table className="w-full text-[12px]">
        <thead>
          <tr className="text-left text-[10.5px] text-faint">
            <th className="py-1 font-normal">Date</th>
            <th className="py-1 font-normal">Security</th>
            <th className="py-1 text-right font-normal">Rate</th>
            <th className="py-1 text-right font-normal" title="Bids received ÷ amount accepted">Bid/cover</th>
            <th className="py-1 text-right font-normal" title="Share taken by indirect bidders (often a proxy for foreign demand)">Indirect</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 10).map((r, i) => (
            <tr key={`${r.date}-${r.term}-${i}`} className="border-t border-line">
              <td className="tabular py-1 text-muted">{r.date.slice(5)}</td>
              <td className="py-1">{r.term} {r.security.toLowerCase()}</td>
              <td className="tabular py-1 text-right">{r.rate?.toFixed(3) ?? "—"}%</td>
              <td className="tabular py-1 text-right">{r.bidToCover?.toFixed(2) ?? "—"}</td>
              <td className="tabular py-1 text-right text-muted">{r.indirectPct !== null ? `${r.indirectPct}%` : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-1 text-[10.5px] text-faint">U.S. Treasury Fiscal Data. Rate is the auction&apos;s high yield (bills: high investment rate).</p>
    </div>
  );
}

/** New S-1/F-1 registration statements (last 30 days). */
export function IpoFilings() {
  const [rows, setRows] = useState<import("@/lib/finance/ipos").Registration[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [onlyIpo, setOnlyIpo] = useState(true);
  useEffect(() => {
    api.ipos().then((r) => setRows(r.filings)).catch((e) => setErr(e.message));
  }, []);
  if (err) return <p className="text-[12px] text-warn">Filings unavailable: {err}</p>;
  if (!rows) return <p className="text-[12px] text-muted">Loading…</p>;
  const shown = rows.filter((r) => !onlyIpo || r.likelyIpo).slice(0, 12);
  return (
    <div>
      <label className="mb-1 flex items-center gap-1.5 text-[11.5px] text-muted">
        <input type="checkbox" checked={onlyIpo} onChange={(e) => setOnlyIpo(e.target.checked)} /> Only companies without a ticker yet (likely IPOs)
      </label>
      <ul>
        {shown.map((r) => (
          <li key={r.url} className="flex items-baseline gap-2 border-t border-line py-1 text-[12px]">
            <span className="tabular shrink-0 text-faint">{r.filed.slice(5)}</span>
            <a href={r.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate hover:text-accent" title={`${r.company} · ${r.form}${r.location ? ` · ${r.location}` : ""}`}>
              {r.company}
            </a>
            <span className="shrink-0 text-[11px] text-faint">{r.ticker ?? r.form}</span>
          </li>
        ))}
        {!shown.length && <li className="text-[12px] text-faint">None in the last 30 days.</li>}
      </ul>
      <p className="mt-1 text-[10.5px] text-faint">SEC EDGAR. A registration statement is a filing, not a completed offering; amendments excluded.</p>
    </div>
  );
}
