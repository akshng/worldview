"use client";
/** Instrument view: price chart with ranges, stats, SEC company data and related events. Information only. */
import clsx from "clsx";
import { useEffect, useState } from "react";
import { api, type InstrumentResponse } from "@/lib/client/api";
import { useUI } from "@/lib/store/ui";
import { DOWN, UP } from "@/lib/finance/format";
import { relativeTime } from "@/lib/time";
import { CATEGORIES } from "@/lib/categories";
import { CloseIcon, ExternalIcon } from "@/components/ui/icons";
import { SafeLink } from "@/components/ui/primitives";
import { LineChart } from "@/components/charts/LineChart";
import { focusEvent } from "@/components/event-feed/EventFeed";

const RANGES = ["1d", "5d", "1mo", "6mo", "1y", "5y"] as const;

const big = (v: number, unit: string) => {
  if (unit === "USD/shares") return `$${v.toFixed(2)}`;
  const a = Math.abs(v);
  const s = a >= 1e12 ? `${(v / 1e12).toFixed(2)}T` : a >= 1e9 ? `${(v / 1e9).toFixed(2)}B` : a >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v.toLocaleString("en-US");
  return `$${s}`;
};

export function InstrumentDetail() {
  const symbol = useUI((s) => s.instrument);
  const open = useUI((s) => s.openInstrument);
  const settings = useUI((s) => s.settings);
  const update = useUI((s) => s.updateSettings);
  const [range, setRange] = useState<(typeof RANGES)[number]>("1mo");
  const [data, setData] = useState<InstrumentResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [above, setAbove] = useState("");
  const [below, setBelow] = useState("");

  useEffect(() => {
    if (!symbol) return;
    const ctrl = new AbortController();
    api
      .instrument(symbol, range, ctrl.signal)
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e) => e.name !== "AbortError" && setError(e.message));
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && open(null);
    window.addEventListener("keydown", onKey);
    return () => {
      ctrl.abort();
      window.removeEventListener("keydown", onKey);
    };
  }, [symbol, range, open]);

  if (!symbol) return null;
  const d = data?.symbol === symbol ? data : null;
  const h = d && !("error" in d.history) ? d.history : null;
  const last = h?.points.at(-1)?.[1] ?? null;
  const first = h?.points[0]?.[1] ?? null;
  const base = range === "1d" ? (h?.previousClose ?? first) : first;
  const chg = last !== null && base ? ((last - base) / base) * 100 : null;
  const color = chg === null ? "var(--accent)" : chg >= 0 ? UP : DOWN;
  const inWatch = settings.watchlist.includes(symbol);
  const alert = settings.alerts.find((a) => a.symbol === symbol);

  const fmtTime = (t: number) =>
    range === "1d" || range === "5d"
      ? new Date(t).toLocaleString([], { weekday: range === "5d" ? "short" : undefined, hour: "2-digit", minute: "2-digit" })
      : new Date(t).toLocaleDateString([], { month: "short", day: "numeric", year: range === "5y" || range === "1y" ? "2-digit" : undefined });

  const saveAlert = () => {
    const a = above.trim() ? Number(above) : null, b = below.trim() ? Number(below) : null;
    if ((a !== null && !Number.isFinite(a)) || (b !== null && !Number.isFinite(b)) || (a === null && b === null)) return;
    update({ alerts: [...settings.alerts.filter((x) => x.symbol !== symbol), { symbol, above: a, below: b, fired: null }] });
    setAbove("");
    setBelow("");
  };

  return (
    <div className="fixed inset-0 z-[60] flex justify-center overflow-y-auto bg-black/60 py-10" onMouseDown={() => open(null)}>
      <div className="glass h-fit w-[860px] rounded-lg shadow-2xl shadow-black/60" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label={`${symbol} details`}>
        <div className="flex items-start justify-between border-b border-line px-6 pt-5 pb-4">
          <div>
            <div className="meta text-faint">{symbol}{h?.exchange ? ` · ${h.exchange}` : ""}{h?.instrumentType ? ` · ${h.instrumentType}` : ""}</div>
            <h2 className="mt-1 text-[20px] font-semibold">{d?.company?.name ?? h?.name ?? symbol}</h2>
            {last !== null && (
              <div className="mt-1 flex items-baseline gap-3">
                <span className="text-[26px] font-semibold">{last.toLocaleString("en-US", { maximumFractionDigits: last >= 1000 ? 0 : 2 })}</span>
                <span className="text-[13px] font-medium" style={{ color }}>
                  {chg === null ? "" : `${chg >= 0 ? "▲ +" : "▼ "}${chg.toFixed(2)}%`}
                </span>
                <span className="text-[11.5px] text-faint">{range === "1d" ? "vs previous close" : `over ${range}`}{h?.currency ? ` · ${h.currency}` : ""}{h?.marketTime ? ` · ${relativeTime(h.marketTime)}` : ""}</span>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => update({ watchlist: inWatch ? settings.watchlist.filter((t) => t !== symbol) : [...settings.watchlist, symbol].slice(0, 25) })}
              className="rounded border border-line px-2.5 py-1 text-[12px] text-muted hover:text-fg"
            >
              {inWatch ? "✓ In watchlist" : "+ Watchlist"}
            </button>
            <button onClick={() => open(null)} className="rounded p-1 text-muted hover:bg-panel-hover hover:text-fg" aria-label="Close">
              <CloseIcon />
            </button>
          </div>
        </div>

        <div className="px-6 py-4">
          <div className="mb-2 flex gap-1">
            {RANGES.map((r) => (
              <button key={r} onClick={() => setRange(r)} className={clsx("meta rounded px-2 py-0.5", r === range ? "bg-accent-soft text-accent" : "text-faint hover:text-fg")}>
                {r.toUpperCase()}
              </button>
            ))}
          </div>
          {error && <p className="text-[12.5px] text-danger">{error}</p>}
          {d && "error" in d.history && <p className="text-[12.5px] text-warn">Price data unavailable: {d.history.error}</p>}
          {!d && !error && <div className="h-[220px] animate-pulse rounded bg-white/[0.03]" />}
          {h && (
            <LineChart
              series={[{ name: symbol, color, points: h.points }]}
              formatX={fmtTime}
              formatY={(y) => y.toLocaleString("en-US", { maximumFractionDigits: y >= 1000 ? 0 : 2 })}
              ariaLabel={`${symbol} price over ${range}`}
            />
          )}
          {h && (
            <dl className="mt-3 grid grid-cols-5 gap-3 text-[12px]">
              {[
                ["Prev. close", h.previousClose],
                ["Day low", h.dayLow],
                ["Day high", h.dayHigh],
                ["52-wk low", h.fiftyTwoWeekLow],
                ["52-wk high", h.fiftyTwoWeekHigh],
              ].map(([k, v]) => (
                <div key={k as string}>
                  <dt className="meta text-faint">{k}</dt>
                  <dd className="tabular mt-0.5">{typeof v === "number" ? v.toLocaleString("en-US", { maximumFractionDigits: 2 }) : "—"}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>

        <div className="grid grid-cols-2 gap-6 border-t border-line px-6 py-4">
          <section>
            {d?.company ? (
              <>
                <h3 className="meta mb-2 text-faint">Company (SEC EDGAR)</h3>
                <div className="text-[12.5px] text-muted">{[d.company.industry, d.company.hq].filter(Boolean).join(" · ")}</div>
                {d.company.fundamentals.length > 0 && (
                  <table className="mt-3 w-full text-[12px]">
                    <thead>
                      <tr className="meta text-faint">
                        <th className="pb-1 text-left font-normal">Reported</th>
                        <th className="pb-1 text-right font-normal">Latest qtr</th>
                        <th className="pb-1 text-right font-normal">Year ago</th>
                        <th className="pb-1 text-right font-normal">Change</th>
                      </tr>
                    </thead>
                    <tbody className="tabular">
                      {d.company.fundamentals.map((f) => {
                        const yoy = f.priorValue ? ((f.value - f.priorValue) / Math.abs(f.priorValue)) * 100 : null;
                        return (
                          <tr key={f.label} className="border-t border-line" title={f.period}>
                            <td className="py-1">
                              {f.label}
                              {f.period !== d.company!.fundamentals[0].period && (
                                <span className="ml-1 text-[10.5px] text-warn">({f.period.replace(/^Calendar /, "").replace(/ \(.*$/, "")})</span>
                              )}
                            </td>
                            <td className="text-right">{big(f.value, f.unit)}</td>
                            <td className="text-right text-muted">{f.priorValue !== null ? big(f.priorValue, f.unit) : "—"}</td>
                            <td className="text-right" style={{ color: yoy === null ? undefined : yoy >= 0 ? UP : DOWN }}>
                              {yoy === null ? "—" : `${yoy >= 0 ? "▲ +" : "▼ "}${yoy.toFixed(1)}%`}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
                {d.company.fundamentals[0] && <p className="mt-1 text-[10.5px] text-faint">{d.company.fundamentals[0].period}; from XBRL financial data in SEC filings.</p>}
                <div className="mt-3 text-[12px]">
                  <span className="text-muted">Insider (Form 4) filings, last 30 days: </span>
                  <span className="tabular">{d.company.insiderFilings30d}</span>
                </div>
                <h4 className="meta mt-3 mb-1 text-faint">Recent filings</h4>
                <ul className="space-y-0.5 text-[12px]">
                  {d.company.filings.slice(0, 8).map((f) => (
                    <li key={f.url}>
                      <SafeLink href={f.url} className="flex items-center gap-2 hover:text-accent">
                        <span className="meta w-14 shrink-0 text-faint normal-case tracking-normal">{f.form}</span>
                        <span className="w-20 shrink-0 tabular text-muted">{f.filed}</span>
                        <span className="truncate">{f.description}</span>
                        <ExternalIcon width={11} height={11} className="shrink-0 opacity-50" />
                      </SafeLink>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="text-[12px] text-faint">{d ? "No SEC registrant found for this symbol (indices, futures, FX and foreign listings have no SEC profile)." : ""}</p>
            )}
          </section>

          <section>
            <h3 className="meta mb-2 text-faint">Price alert (in-app)</h3>
            {alert && (
              <div className="mb-2 flex items-center justify-between rounded border border-line px-2 py-1 text-[12px]">
                <span>
                  {alert.above !== null && <>Above <span className="tabular">{alert.above}</span> </>}
                  {alert.below !== null && <>Below <span className="tabular">{alert.below}</span></>}
                </span>
                <button className="text-faint hover:text-fg" onClick={() => update({ alerts: settings.alerts.filter((a) => a.symbol !== symbol) })}>Remove</button>
              </div>
            )}
            <div className="flex gap-1.5">
              <input value={above} onChange={(e) => setAbove(e.target.value)} placeholder="Above" inputMode="decimal" aria-label="Alert above price" className="w-24 rounded border border-line bg-bg-elev px-2 py-1 text-[12px]" />
              <input value={below} onChange={(e) => setBelow(e.target.value)} placeholder="Below" inputMode="decimal" aria-label="Alert below price" className="w-24 rounded border border-line bg-bg-elev px-2 py-1 text-[12px]" />
              <button onClick={saveAlert} className="rounded border border-line px-2 text-[12px] text-muted hover:text-fg">Set</button>
            </div>
            <p className="mt-1 text-[10.5px] text-faint">Checked every few minutes while WorldView is open, using delayed prices.</p>

            <h3 className="meta mt-4 mb-2 text-faint">World events about this company</h3>
            {d?.events.length ? (
              <ul className="space-y-1">
                {d.events.map((e) => (
                  <li key={e.id}>
                    <button
                      onClick={() => {
                        open(null);
                        useUI.getState().setMarketsOpen(false);
                        focusEvent(e);
                      }}
                      className="w-full rounded px-1.5 py-1 text-left hover:bg-panel-hover"
                    >
                      <span className="meta mr-1.5" style={{ color: CATEGORIES[e.type].color }}>{CATEGORIES[e.type].label}</span>
                      <span className="text-[12px]">{e.title}</span>
                      <span className="meta ml-1.5 normal-case tracking-normal text-faint">{relativeTime(e.timestamp)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[12px] text-faint">No stored events in the last 8 days.</p>
            )}
          </section>
        </div>
        <p className="border-t border-line px-6 py-2.5 text-[10.5px] text-faint">{d?.note ?? "Information only — not investment advice."}</p>
      </div>
    </div>
  );
}
