"use client";
/**
 * Charts: plot anything over time — events (by type, source, country), any
 * ticker's price, or a macro indicator. One series per card (small multiples:
 * different units never share an axis). The set is saved in the UI store.
 */
import clsx from "clsx";
import { useEffect, useState } from "react";
import { LineChart } from "./LineChart";
import { api } from "@/lib/client/api";
import { downloadText, exportName, seriesToCsv } from "@/lib/client/export";
import { CATEGORY_LIST } from "@/lib/categories";
import type { ChartSpec } from "@/lib/charts/specs";
import { useUI } from "@/lib/store/ui";
import type { EventCategory } from "@/types/events";

type Loaded = { points: Array<[number, number]>; latest: string; note: string } | { error: string } | null;

const fmtDay = (x: number) => new Date(x).toLocaleDateString("en-US", { month: "short", day: "numeric" });
const fmtHour = (x: number) => new Date(x).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric" });
const fmtNum = (y: number) => y.toLocaleString("en-US", { maximumFractionDigits: Math.abs(y) >= 1000 ? 0 : 2 });

function useChartData(spec: ChartSpec): Loaded {
  const [data, setData] = useState<Loaded>(null);
  const key = JSON.stringify(spec);
  useEffect(() => {
    const ctrl = new AbortController();
    const q = (u: string) => fetch(u, { signal: ctrl.signal }).then(async (r) => (r.ok ? r.json() : Promise.reject(new Error((await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`))));
    const s = JSON.parse(key) as ChartSpec;
    (async () => {
      if (s.kind === "events") {
        const p = new URLSearchParams({ days: String(s.days), ...(s.type ? { type: s.type } : {}), ...(s.source ? { source: s.source } : {}), ...(s.country ? { country: s.country } : {}) });
        const d = await q(`/api/events/timeseries?${p}`);
        return { points: d.points, latest: `${d.total.toLocaleString("en-US")} in ${s.days} days`, note: `Events per ${d.bucket} · the last ${d.bucket} is still in progress` };
      }
      if (s.kind === "price") {
        const d = await q(`/api/markets/history?symbol=${encodeURIComponent(s.symbol)}&range=${s.range}`);
        const pts = d.points as Array<[number, number]>;
        const first = pts[0]?.[1];
        const last = pts.at(-1)?.[1];
        const chg = first && last ? ((last - first) / first) * 100 : null;
        return { points: pts, latest: last !== undefined ? `${fmtNum(last)}${chg !== null ? ` (${chg >= 0 ? "+" : ""}${chg.toFixed(1)}% over ${s.range})` : ""}` : "—", note: `${d.name ?? s.symbol} · delayed` };
      }
      const m = await api.macro(ctrl.signal);
      const ind = m.indicators.find((i) => i.id === s.indicator);
      if (!ind) throw new Error("Indicator not found");
      return { points: ind.spark.map((v, i) => [i, v] as [number, number]), latest: `${ind.value ?? "—"}${ind.unit && ind.unit !== "index" ? ` ${ind.unit}` : ""}${ind.asOf ? ` · as of ${ind.asOf}` : ""}`, note: `${ind.source} · recent readings` };
    })()
      .then(setData)
      .catch((e) => e.name !== "AbortError" && setData({ error: e.message }));
    return () => ctrl.abort();
  }, [key]);
  return data;
}

function ChartCard({ spec, onRemove }: { spec: ChartSpec; onRemove: () => void }) {
  const d = useChartData(spec);
  const showOnMap = () => {
    if (spec.kind !== "events") return;
    const ui = useUI.getState();
    if (spec.type) ui.setCategories([spec.type]);
    ui.setSourceFilter(spec.source ? [spec.source] : []);
    if (spec.country) ui.selectCountry(spec.country);
    ui.setView("world");
  };
  return (
    <div className="glass flex flex-col rounded-md p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-[14px] font-medium">{spec.title}</div>
          <div className="mt-0.5 text-[12px] text-muted">{d && "latest" in d ? d.latest : " "}</div>
        </div>
        <div className="flex shrink-0 gap-1">
          {d && "points" in d && d.points.length > 0 && (
            <button
              onClick={() => downloadText(exportName(spec.title, "csv"), "text/csv", seriesToCsv(d.points, { xIsTime: spec.kind !== "macro", name: spec.kind === "events" ? "events" : spec.kind === "price" ? "price" : "value" }))}
              className="rounded border border-line px-1.5 py-0.5 text-[11px] text-muted hover:text-fg"
              title="Download this series as CSV"
            >
              Export
            </button>
          )}
          {spec.kind === "events" && (
            <button onClick={showOnMap} className="rounded border border-line px-1.5 py-0.5 text-[11px] text-muted hover:text-fg" title="Open these events on the globe">
              Map
            </button>
          )}
          <button onClick={onRemove} className="rounded border border-line px-1.5 py-0.5 text-[11px] text-muted hover:text-fg" title="Remove chart" aria-label={`Remove ${spec.title}`}>
            ✕
          </button>
        </div>
      </div>
      <div className="mt-2">
        {!d && <div className="h-[200px] animate-pulse rounded bg-white/[0.03]" />}
        {d && "error" in d && <p className="grid h-[200px] place-items-center text-[12px] text-warn">{d.error}</p>}
        {d && "points" in d && (
          <LineChart
            series={[{ name: spec.title, color: "var(--accent)", points: d.points }]}
            height={200}
            width={560}
            formatX={spec.kind === "macro" ? (x) => `#${x + 1}` : spec.kind === "events" && spec.days <= 2 ? fmtHour : fmtDay}
            formatY={spec.kind === "events" ? (y) => String(Math.round(y)) : fmtNum}
            ariaLabel={`${spec.title} over time`}
          />
        )}
      </div>
      {d && "note" in d && <p className="mt-1 text-[10.5px] text-faint">{d.note}</p>}
    </div>
  );
}

function AddChart({ onAdd }: { onAdd: (s: ChartSpec) => void }) {
  const [kind, setKind] = useState<ChartSpec["kind"]>("events");
  const [type, setType] = useState<string>("");
  const [source, setSource] = useState("");
  const [country, setCountry] = useState("");
  const [days, setDays] = useState(7);
  const [symbol, setSymbol] = useState("");
  const [range, setRange] = useState<"1mo" | "6mo" | "1y" | "5y">("6mo");
  const [indicator, setIndicator] = useState("");
  const [sources, setSources] = useState<Array<{ id: string; name: string }>>([]);
  const [countries, setCountries] = useState<Array<{ code: string; name: string }>>([]);
  const [indicators, setIndicators] = useState<Array<{ id: string; name: string }>>([]);

  useEffect(() => {
    const ctrl = new AbortController();
    api.sources(ctrl.signal).then((d) => setSources(d.sources.filter((s) => s.id !== "demo").map((s) => ({ id: s.id, name: s.name })).sort((a, b) => a.name.localeCompare(b.name)))).catch(() => {});
    fetch("/api/countries", { signal: ctrl.signal }).then((r) => r.json()).then((d) => setCountries(d.countries ?? [])).catch(() => {});
    api.macro(ctrl.signal).then((m) => setIndicators(m.indicators.filter((i) => i.spark.length > 2).map((i) => ({ id: i.id, name: i.name })))).catch(() => {});
    return () => ctrl.abort();
  }, []);

  const add = () => {
    const id = `c${Date.now()}`;
    if (kind === "events") {
      const parts = [type ? CATEGORY_LIST.find((c) => c.id === type)?.layerLabel : "Events", source && `from ${sources.find((s) => s.id === source)?.name ?? source}`, country && `in ${countries.find((c) => c.code === country)?.name ?? country}`].filter(Boolean);
      onAdd({ id, kind, title: `${parts.join(" ")} per ${days <= 2 ? "hour" : "day"}`, type: (type || null) as EventCategory | null, source: source || null, country: country || null, days });
    } else if (kind === "price") {
      if (!symbol.trim()) return;
      onAdd({ id, kind, title: symbol.trim().toUpperCase(), symbol: symbol.trim().toUpperCase(), range });
    } else {
      if (!indicator) return;
      onAdd({ id, kind, title: indicators.find((i) => i.id === indicator)?.name ?? indicator, indicator });
    }
  };

  const sel = "rounded-md border border-line bg-panel px-2 py-1.5 text-[12.5px] outline-none focus:border-line-strong";
  return (
    <div className="glass rounded-md p-4">
      <div className="mb-3 flex items-center gap-2">
        <span className="meta text-faint">Add a chart</span>
        {(["events", "price", "macro"] as const).map((k) => (
          <button key={k} onClick={() => setKind(k)} className={clsx("rounded-md border px-2.5 py-1 text-[12px]", kind === k ? "border-accent text-fg" : "border-line text-muted hover:text-fg")}>
            {k === "events" ? "Events" : k === "price" ? "Markets" : "Economy"}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {kind === "events" && (
          <>
            <select value={type} onChange={(e) => setType(e.target.value)} className={sel} aria-label="Event type">
              <option value="">All event types</option>
              {CATEGORY_LIST.map((c) => (
                <option key={c.id} value={c.id}>{c.layerLabel}</option>
              ))}
            </select>
            <select value={source} onChange={(e) => setSource(e.target.value)} className={clsx(sel, "max-w-[220px]")} aria-label="Source">
              <option value="">Any source</option>
              {sources.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            <select value={country} onChange={(e) => setCountry(e.target.value)} className={clsx(sel, "max-w-[180px]")} aria-label="Country">
              <option value="">Anywhere</option>
              {countries.map((c) => (
                <option key={c.code} value={c.code}>{c.name}</option>
              ))}
            </select>
            <select value={days} onChange={(e) => setDays(Number(e.target.value))} className={sel} aria-label="Period">
              {[2, 7, 14, 30].map((d) => (
                <option key={d} value={d}>Last {d} days</option>
              ))}
            </select>
          </>
        )}
        {kind === "price" && (
          <>
            <input value={symbol} onChange={(e) => setSymbol(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} placeholder="Ticker, e.g. NVDA, ^GSPC, BTC-USD, CL=F" className={clsx(sel, "w-[280px]")} aria-label="Ticker" />
            <select value={range} onChange={(e) => setRange(e.target.value as typeof range)} className={sel} aria-label="Range">
              {(["1mo", "6mo", "1y", "5y"] as const).map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </>
        )}
        {kind === "macro" && (
          <select value={indicator} onChange={(e) => setIndicator(e.target.value)} className={clsx(sel, "min-w-[280px]")} aria-label="Indicator">
            <option value="">Pick an indicator…</option>
            {indicators.map((i) => (
              <option key={i.id} value={i.id}>{i.name}</option>
            ))}
          </select>
        )}
        <button onClick={add} className="rounded-md bg-accent-soft px-3 py-1.5 text-[12.5px] text-accent hover:brightness-110">
          Add chart
        </button>
      </div>
    </div>
  );
}

export function ChartsPage() {
  const charts = useUI((s) => s.charts);
  const setCharts = useUI((s) => s.setCharts);
  return (
    <div className="mx-auto w-full max-w-[1320px] px-6 py-6">
      <div className="meta text-accent">Charts</div>
      <h2 className="mt-1 text-[20px] font-semibold tracking-tight">Plot anything over time</h2>
      <p className="mt-1 mb-4 text-[12px] text-faint">Events by type, source or country · any ticker · economic indicators. Your charts are saved.</p>
      <AddChart onAdd={(s) => setCharts([s, ...charts].slice(0, 24))} />
      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
        {charts.map((c) => (
          <ChartCard key={c.id} spec={c} onRemove={() => setCharts(charts.filter((x) => x.id !== c.id))} />
        ))}
      </div>
      {!charts.length && <p className="mt-6 text-center text-[13px] text-faint">No charts yet. Add one above.</p>}
    </div>
  );
}
