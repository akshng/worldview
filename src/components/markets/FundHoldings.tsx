"use client";
/**
 * Fund holdings from SEC Form 13F: a list of tracked managers that opens a
 * holdings table (weights, quarter-over-quarter change, filing links). Holdings
 * with a ticker open the instrument view. Information only.
 */
import clsx from "clsx";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/client/api";
import type { ChangeKind, Holding, ManagerHoldings, ManagerSummary } from "@/lib/finance/thirteenf";
import { DOWN, UP } from "@/lib/finance/format";
import { useUI } from "@/lib/store/ui";
import { ExternalIcon } from "@/components/ui/icons";
import { SafeLink } from "@/components/ui/primitives";

export const usd = (v: number) => {
  const a = Math.abs(v);
  return a >= 1e12 ? `$${(v / 1e12).toFixed(2)}T` : a >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : a >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : `$${Math.round(v / 1e3).toLocaleString("en-US")}K`;
};
const count = (n: number) => (Math.abs(n) >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : Math.abs(n) >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : n.toLocaleString("en-US"));
export const quarter = (period?: string) => {
  const m = period?.match(/^(\d{4})-(\d{2})/);
  return m ? `Q${Math.ceil(Number(m[2]) / 3)} ${m[1]}` : (period ?? "—");
};

/** QoQ change: arrow + signed % + colour, or a NEW marker. Colour is never the only cue. */
export function ChangeBadge({ change, pct }: { change: ChangeKind | null; pct: number | null }) {
  if (change === null) return <span className="text-faint">—</span>;
  if (change === "new") return <span className="rounded bg-accent/15 px-1 text-[10.5px] font-semibold tracking-wide text-accent" title="New position this quarter">NEW</span>;
  if (change === "unchanged") return <span className="text-faint" title="Share count unchanged">= 0%</span>;
  const up = change === "added";
  const text = pct === null ? (up ? "added" : "reduced") : `${up ? "+" : "−"}${Math.abs(pct) >= 1000 ? Math.round(Math.abs(pct)).toLocaleString("en-US") : Math.abs(pct).toFixed(1)}%`;
  return (
    <span style={{ color: up ? UP : DOWN }} title={`${up ? "Added" : "Reduced"} shares vs prior quarter`}>
      {up ? "▲" : "▼"} {text}
    </span>
  );
}

function Caveats({ items }: { items: string[] }) {
  return (
    <ul className="mt-2 space-y-0.5 text-[10.5px] leading-snug text-faint">
      {items.map((c) => (
        <li key={c}>· {c}</li>
      ))}
    </ul>
  );
}

const FALLBACK_CAVEATS = [
  "13F reports are filed up to 45 days after quarter end — positions may have changed since.",
  "Long positions in US-listed equities (and listed options) only; short positions are not shown.",
  "Information only — not investment advice.",
];

export function FundHoldings() {
  const [list, setList] = useState<{ managers: ManagerSummary[]; pending: number; caveats: string[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let polls = 0;
    const load = () =>
      api
        .thirteenFManagers(ctrl.signal)
        .then((d) => {
          setList(d);
          setErr(null);
          // Managers load in the background on first use; poll until all are in (≤ ~5 min).
          if (d.pending > 0 && polls++ < 60) timer = setTimeout(load, 5000);
        })
        .catch((e) => e.name !== "AbortError" && setErr(e.message));
    load();
    return () => {
      ctrl.abort();
      clearTimeout(timer);
    };
  }, []);

  if (selected) return <ManagerHoldingsView cik={selected} onBack={() => setSelected(null)} />;
  if (err) return <p className="text-[12px] text-warn">13F holdings unavailable: {err}</p>;
  if (!list) return <p className="text-[12px] text-muted">Loading managers…</p>;

  const rows = [...list.managers].sort((a, b) => (b.totalValue ?? -1) - (a.totalValue ?? -1));
  return (
    <div>
      <div className="mb-1 grid grid-cols-[1fr_64px_72px_56px_1fr] gap-2 px-1 text-[10.5px] text-faint">
        <span>Manager</span>
        <span>Report</span>
        <span className="text-right">13F value</span>
        <span className="text-right">Positions</span>
        <span>Largest holdings</span>
      </div>
      <ul>
        {rows.map((m) => (
          <li key={m.cik}>
            <button
              onClick={() => m.status === "ready" && setSelected(m.cik)}
              disabled={m.status !== "ready"}
              title={`${m.label} — ${m.note}${m.name ? ` (EDGAR: ${m.name})` : ""}${m.filed ? `. Filed ${m.filed}` : ""}`}
              className="grid w-full grid-cols-[1fr_64px_72px_56px_1fr] items-center gap-2 rounded px-1 py-[3px] text-left enabled:hover:bg-panel-hover disabled:cursor-default"
            >
              <span className="truncate text-[12px] font-medium">{m.label}</span>
              {m.status === "ready" ? (
                <>
                  <span className="tabular text-[11.5px] text-muted">{quarter(m.period)}</span>
                  <span className="tabular text-right text-[12px]">{usd(m.totalValue ?? 0)}</span>
                  <span className="tabular text-right text-[12px] text-muted">{(m.positionCount ?? 0).toLocaleString("en-US")}</span>
                  <span className="truncate text-[11px] text-muted">
                    {m.top?.map((t) => `${t.ticker ?? t.issuer}${t.putCall ? ` (${t.putCall.toLowerCase()})` : ""} ${t.weight.toFixed(1)}%`).join(" · ")}
                  </span>
                </>
              ) : (
                <span className={clsx("col-span-4 text-[11.5px]", m.status === "error" ? "text-warn" : "text-faint")}>
                  {m.status === "loading" ? "Loading from SEC…" : m.status === "none" ? "No recent 13F holdings report" : `Unavailable${m.error ? `: ${m.error}` : ""}`}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
      {list.pending > 0 && <p className="mt-1 text-[11px] text-faint">Fetching {list.pending} more filings from SEC EDGAR (first load only; cached for 24 h)…</p>}
      <Caveats items={list.caveats.length ? list.caveats : FALLBACK_CAVEATS} />
    </div>
  );
}

type SortKey = "weight" | "change" | "name";

/** Ordinary share-class labels that add nothing next to the issuer name. */
const PLAIN_CLASS = /^(COM|COMMON|CL [A-Z]|CLASS [A-Z]|CAP STK|SHS|ORD|ORDINARY|CALL|PUT)\b/i;

function ManagerHoldingsView({ cik, onBack }: { cik: string; onBack: () => void }) {
  const [data, setData] = useState<ManagerHoldings | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("weight");
  const [options, setOptions] = useState(true);
  const [limit, setLimit] = useState(50);
  const openInstrument = useUI((s) => s.openInstrument);

  useEffect(() => {
    const ctrl = new AbortController();
    api.thirteenFHoldings(cik, ctrl.signal).then(setData).catch((e) => e.name !== "AbortError" && setErr(e.message));
    return () => ctrl.abort();
  }, [cik]);

  const rows = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toUpperCase();
    const list = data.holdings
      .map((h, i) => ({ h, rank: i + 1 }))
      .filter(({ h }) => (options || !h.putCall) && (!q || h.issuer.toUpperCase().includes(q) || h.titleOfClass.toUpperCase().includes(q) || h.ticker?.includes(q) || h.cusip.includes(q)));
    const changeScore = (h: Holding) => (h.change === "new" ? Infinity : (h.sharesChangePct ?? 0));
    if (sort === "change") list.sort((a, b) => changeScore(b.h) - changeScore(a.h));
    if (sort === "name") list.sort((a, b) => a.h.issuer.localeCompare(b.h.issuer));
    return list;
  }, [data, query, sort, options]);

  const header = (
    <button onClick={onBack} className="mb-2 text-[11.5px] text-muted hover:text-fg">
      ← All managers
    </button>
  );
  if (err) return <div>{header}<p className="text-[12px] text-warn">Holdings unavailable: {err}</p></div>;
  if (!data) return <div>{header}<p className="text-[12px] text-muted">Loading holdings from SEC EDGAR…</p></div>;

  const maxW = Math.max(...data.holdings.map((h) => h.weight), 1);
  const shown = rows.slice(0, limit);
  const c = data.counts;
  return (
    <div>
      {header}
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div>
          <div className="text-[14px] font-semibold">{data.label}</div>
          <div className="text-[11.5px] text-muted">
            {data.note} · {quarter(data.latest.period)} (as of {data.latest.period}, filed {data.latest.filed}) · {usd(data.totalValue)} across {data.positionCount.toLocaleString("en-US")} positions
          </div>
          {data.prior && (
            <div className="text-[11.5px] text-muted">
              vs {quarter(data.prior.period)}: <span style={{ color: UP }}>{c.new} new</span> · <span style={{ color: UP }}>▲ {c.added} added</span> · <span style={{ color: DOWN }}>▼ {c.reduced} reduced</span> · <span style={{ color: DOWN }}>{c.soldOut} sold out</span> · {c.unchanged} unchanged
            </div>
          )}
        </div>
        <SafeLink href={data.latest.url} className="flex items-center gap-1 text-[11.5px] text-accent hover:underline" title={`${data.latest.form} ${data.latest.accession}`}>
          {data.latest.form} on EDGAR <ExternalIcon width={11} height={11} />
        </SafeLink>
      </div>

      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter by name, ticker or CUSIP"
          aria-label="Filter holdings"
          className="w-56 rounded border border-line bg-bg-elev px-2 py-1 text-[12px]"
        />
        <label className="flex items-center gap-1 text-[11.5px] text-muted">
          Sort
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="rounded border border-line bg-bg-elev px-1 py-0.5 text-[11.5px]">
            <option value="weight">Weight</option>
            <option value="change">Share change</option>
            <option value="name">Name</option>
          </select>
        </label>
        <label className="flex items-center gap-1 text-[11.5px] text-muted">
          <input type="checkbox" checked={options} onChange={(e) => setOptions(e.target.checked)} /> Include options
        </label>
      </div>

      <div className="grid grid-cols-[28px_1fr_70px_96px_70px_76px] gap-2 px-1 text-[10.5px] text-faint">
        <span className="text-right">#</span>
        <span>Issuer</span>
        <span className="text-right">Value</span>
        <span>Weight</span>
        <span className="text-right">Shares</span>
        <span className="text-right">vs prior qtr</span>
      </div>
      <ul>
        {shown.map(({ h, rank }) => {
          const clickable = !!h.ticker && !h.putCall;
          return (
            <li key={h.key}>
              <button
                onClick={() => clickable && openInstrument(h.ticker!)}
                disabled={!clickable}
                title={[
                  `${h.issuer} — ${h.titleOfClass || "—"} · CUSIP ${h.cusip}`,
                  h.ticker ? `Ticker ${h.ticker} ${h.tickerSource === "cusip" ? "(known CUSIP)" : "(matched by name — best effort)"}` : "No ticker match",
                  h.priorShares !== null ? `Prior quarter: ${h.priorShares.toLocaleString("en-US")} ${h.shareType === "PRN" ? "principal" : "shares"}` : "",
                ]
                  .filter(Boolean)
                  .join("\n")}
                className="grid w-full grid-cols-[28px_1fr_70px_96px_70px_76px] items-center gap-2 rounded px-1 py-[3px] text-left enabled:hover:bg-panel-hover disabled:cursor-default"
              >
                <span className="tabular text-right text-[11px] text-faint">{rank}</span>
                <span className="flex min-w-0 items-center gap-1.5">
                  {h.ticker && <span className={clsx("shrink-0 text-[12px] font-medium", clickable && "text-accent")}>{h.ticker}</span>}
                  <span className="truncate text-[11.5px] text-muted">
                    {h.issuer}
                    {/* Fund trusts (e.g. "ISHARES TR") name the actual fund in the class column */}
                    {h.titleOfClass && !PLAIN_CLASS.test(h.titleOfClass) && <span className="text-faint"> · {h.titleOfClass}</span>}
                  </span>
                  {h.putCall && <span className="shrink-0 rounded border border-line px-1 text-[10px] text-muted">{h.putCall.toUpperCase()}</span>}
                  {h.shareType === "PRN" && <span className="shrink-0 rounded border border-line px-1 text-[10px] text-muted">DEBT</span>}
                </span>
                <span className="tabular text-right text-[12px]">{usd(h.value)}</span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2 flex-1 rounded-[2px] bg-white/5">
                    <span className="block h-2 rounded-[2px] bg-white/35" style={{ width: `${(h.weight / maxW) * 100}%` }} />
                  </span>
                  <span className="tabular w-10 text-right text-[11.5px]">{h.weight < 0.01 ? "<0.01" : h.weight.toFixed(2)}%</span>
                </span>
                <span className="tabular text-right text-[11.5px] text-muted">{count(h.shares)}</span>
                <span className="tabular text-right text-[11.5px]">
                  <ChangeBadge change={h.change} pct={h.sharesChangePct} />
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {!shown.length && <p className="px-1 text-[12px] text-faint">No holdings match.</p>}
      {rows.length > limit && (
        <button onClick={() => setLimit((l) => l + 50)} className="mt-1 text-[11.5px] text-accent hover:underline">
          Show more ({rows.length - limit} of the {data.holdings.length} largest)
        </button>
      )}
      {data.truncated > 0 && <p className="mt-1 text-[10.5px] text-faint">The {data.truncated.toLocaleString("en-US")} smallest positions aren&apos;t loaded here; the full table is in the filing.</p>}

      {data.soldOut.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-[11.5px] text-muted">Sold out since {quarter(data.prior?.period)} ({data.counts.soldOut})</summary>
          <ul className="mt-1">
            {data.soldOut.slice(0, 25).map((s) => (
              <li key={s.key} className="grid grid-cols-[1fr_auto] gap-2 px-1 py-[2px] text-[11.5px]">
                <span className="truncate text-muted">
                  {s.ticker && <span className="mr-1.5 font-medium text-fg">{s.ticker}</span>}
                  {s.issuer}
                  {s.putCall && ` (${s.putCall.toUpperCase()})`}
                </span>
                <span className="tabular" style={{ color: DOWN }}>
                  ▼ was {usd(s.priorValue)} · {s.priorWeight.toFixed(2)}%
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
      <p className="mt-2 text-[10.5px] text-faint">
        Values in US dollars as reported ({data.latest.valueUnit === "thousands" ? "filed in thousands, converted" : "filed in dollars"}). Changes compare share counts with the {data.prior ? `${quarter(data.prior.period)} 13F` : "prior 13F (none available)"}. Tickers are matched by company name (best effort) — check the CUSIP in the filing.
        {data.latest.amendments.length > 0 && ` Includes ${data.latest.amendments.length} amendment(s).`}
        {data.latest.form === "13F-HR/A" && " This period was restated by an amendment; the restated table is shown."}
      </p>
      <Caveats items={data.caveats} />
    </div>
  );
}
