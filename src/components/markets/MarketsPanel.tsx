"use client";
/**
 * Markets view: cross-asset snapshot, watchlist, world events with rule-based
 * market exposure, and an optional AI market wrap. Information only — never advice.
 */
import clsx from "clsx";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type ExposureLink, type MarketSnapshot, type Quote } from "@/lib/client/api";
import { useUI } from "@/lib/store/ui";
import { useData } from "@/lib/client/data-store";
import { CATEGORIES } from "@/lib/categories";
import { relativeTime } from "@/lib/time";
import { DOWN, UP, formatChange } from "@/lib/finance/format";
import { CloseIcon, SparkIcon } from "@/components/ui/icons";
import { StatusBadge } from "@/components/ui/primitives";
import { focusEvent } from "@/components/event-feed/EventFeed";
import type { EventSummary } from "@/types/events";
import { QuoteTile } from "./QuoteTile";
import { EconomicCalendar, SectorBars, YieldCurve } from "./MarketExtras";
import { MacroDashboard } from "./MacroDashboard";
import { StockMovers } from "./StockMovers";
import { CryptoTable } from "./CryptoTable";

const GROUPS: Array<{ id: keyof MarketSnapshot["groups"]; title: string }> = [
  { id: "indices", title: "Equity indices" },
  { id: "sectors", title: "US sectors (SPDR ETFs)" },
  { id: "rates", title: "US Treasury yields" },
  { id: "fx", title: "Currencies" },
  { id: "bonds", title: "Bonds & credit (ETFs)" },
  { id: "volatility", title: "Volatility" },
  { id: "commodities", title: "Commodities" },
  { id: "crypto", title: "Crypto" },
];

export function MarketsPanel() {
  const open = useUI((s) => s.marketsOpen);
  const setOpen = useUI((s) => s.setMarketsOpen);
  const watchlist = useUI((s) => s.settings.watchlist);
  const updateSettings = useUI((s) => s.updateSettings);
  const meta = useData((s) => s.meta);
  const events = useData((s) => s.events);
  const [snap, setSnap] = useState<MarketSnapshot | null>(null);
  const [watch, setWatch] = useState<Quote[]>([]);
  const [movers, setMovers] = useState<Array<{ event: EventSummary; exposure: ExposureLink[] }>>([]);
  const [error, setError] = useState<string | null>(null);
  const [ticker, setTicker] = useState("");
  const [summary, setSummary] = useState<{ text: string; provider: string; model: string; generatedAt: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [aiErr, setAiErr] = useState<string | null>(null);

  const loadWatch = useCallback(() => {
    if (!watchlist.length) return;
    api.quotes(watchlist).then((r) => setWatch(r.quotes)).catch(() => {});
  }, [watchlist]);

  useEffect(() => {
    if (!open) return;
    const load = () => {
      api.markets().then(setSnap).catch((e) => setError(e.message));
      api.movers().then((r) => setMovers(r.movers)).catch(() => {});
    };
    load();
    loadWatch();
    const t = setInterval(() => {
      load();
      loadWatch();
    }, 60_000);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => {
      clearInterval(t);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, setOpen, loadWatch]);

  // Every quote we hold, for exposure chips.
  const bySymbol = useMemo(() => {
    const m = new Map<string, Quote>();
    if (snap) for (const g of Object.values(snap.groups)) for (const q of g) m.set(q.symbol, q);
    for (const q of watch) m.set(q.symbol, q);
    return m;
  }, [snap, watch]);

  // Events linked to watchlist tickers (SEC filings or entity codes).
  const watchEvents = useMemo(() => {
    const set = new Set(watchlist.map((t) => t.toUpperCase()));
    return events.filter((e) => typeof e.metrics.ticker === "string" && set.has(String(e.metrics.ticker).toUpperCase()));
  }, [events, watchlist]);

  if (!open) return null;

  const addTicker = () => {
    const t = ticker.trim().toUpperCase();
    if (!/^[A-Z0-9.^=\-]{1,15}$/.test(t) || watchlist.includes(t) || watchlist.length >= 25) return;
    updateSettings({ watchlist: [...watchlist, t] });
    setTicker("");
  };

  const writeSummary = async () => {
    setBusy(true);
    setAiErr(null);
    try {
      setSummary((await api.marketSummary()).summary);
    } catch (e) {
      setAiErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const pick = (e: EventSummary) => {
    setOpen(false);
    focusEvent(e);
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-center overflow-y-auto bg-black/60 py-8" onMouseDown={() => setOpen(false)}>
      <div className="glass h-fit w-[1040px] rounded-lg shadow-2xl shadow-black/60" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Markets">
        <div className="flex items-start justify-between border-b border-line px-6 pt-5 pb-4">
          <div>
            <div className="meta text-accent">Markets</div>
            <h2 className="mt-1 text-[20px] font-semibold tracking-tight">Cross-asset view & world events</h2>
            <p className="mt-1 text-[11.5px] text-faint">
              Information only — not investment advice. Index/FX/commodity quotes are delayed (unofficial Yahoo Finance); crypto from Coinbase; yields from the U.S. Treasury.
              {snap && ` Updated ${relativeTime(snap.generatedAt)}.`}
            </p>
          </div>
          <button onClick={() => setOpen(false)} className="rounded p-1 text-muted hover:bg-panel-hover hover:text-fg" aria-label="Close markets">
            <CloseIcon />
          </button>
        </div>

        <div className="grid grid-cols-[1fr_340px] gap-6 px-6 py-5">
          <div className="min-w-0">
            {error && <p className="text-[12.5px] text-danger">{error}</p>}
            {!snap && !error && <p className="text-[12.5px] text-muted">Loading market data…</p>}
            {snap &&
              GROUPS.map((g) => (
                <section key={g.id} className="mb-5">
                  <h3 className="meta mb-2 text-faint">{g.title}</h3>
                  {g.id === "sectors" ? (
                    <SectorBars sectors={snap.groups.sectors} />
                  ) : (
                    <div className="grid grid-cols-3 gap-2">
                      {snap.groups[g.id].map((q) => (
                        <QuoteTile key={q.symbol} q={q} compact onOpen={q.group === "rates" ? undefined : () => useUI.getState().openInstrument(q.symbol)} />
                      ))}
                    </div>
                  )}
                  {g.id === "rates" && (
                    <div className="mt-3">
                      <div className="meta mb-1 text-faint">Yield curve — latest vs one month earlier</div>
                      <YieldCurve />
                    </div>
                  )}
                </section>
              ))}
            {snap && (
              <section className="mb-5">
                <h3 className="meta mb-2 text-faint">Crypto · top 20 by market cap</h3>
                <CryptoTable />
              </section>
            )}
            {snap && (
              <section className="mb-5">
                <h3 className="meta mb-2 text-faint">US economy · key indicators</h3>
                <MacroDashboard />
              </section>
            )}
          </div>

          <aside className="min-w-0 space-y-5">
            <section>
              <h3 className="meta mb-2 text-faint">Watchlist</h3>
              <div className="mb-2 flex gap-1.5">
                <input
                  value={ticker}
                  onChange={(e) => setTicker(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addTicker()}
                  placeholder="Add ticker (e.g. MSFT, ^GSPC, EURUSD=X)"
                  aria-label="Add ticker"
                  className="flex-1 rounded border border-line bg-bg-elev px-2 py-1 text-[12px] placeholder:text-faint"
                />
                <button onClick={addTicker} className="rounded border border-line px-2 text-[12px] text-muted hover:text-fg">Add</button>
              </div>
              <div className="space-y-1.5">
                {watch.filter((q) => watchlist.includes(q.symbol)).map((q) => (
                  <QuoteTile key={q.symbol} q={q} compact onOpen={() => useUI.getState().openInstrument(q.symbol)} onRemove={() => updateSettings({ watchlist: watchlist.filter((t) => t !== q.symbol) })} />
                ))}
                {!watchlist.length && <p className="text-[12px] text-faint">Add tickers to follow them alongside world events.</p>}
              </div>
              {watchEvents.length > 0 && (
                <div className="mt-2">
                  <div className="meta mb-1 text-faint">Filings for your tickers</div>
                  {watchEvents.slice(0, 6).map((e) => (
                    <button key={e.id} onClick={() => pick(e)} className="block w-full truncate rounded px-1.5 py-1 text-left text-[12px] hover:bg-panel-hover">
                      {e.title}
                    </button>
                  ))}
                </div>
              )}
            </section>

            <section>
              <h3 className="meta mb-2 text-faint">US stock movers today</h3>
              <StockMovers />
            </section>

            <section>
              <h3 className="meta mb-2 text-faint">Economic calendar · next 2 weeks</h3>
              <EconomicCalendar />
            </section>

            <section className="rounded-md border border-ai/25 bg-ai-soft px-3 py-2.5">
              <div className="mb-1 flex items-center justify-between">
                <h3 className="meta flex items-center gap-1.5 text-ai"><SparkIcon width={12} height={12} /> AI market wrap</h3>
                <span className="meta text-ai/60">Not advice</span>
              </div>
              {summary ? (
                <>
                  <p className="text-[12.5px] leading-relaxed whitespace-pre-line text-fg/85">{summary.text}</p>
                  <div className="meta mt-1.5 normal-case tracking-normal text-faint">{summary.provider} · {summary.model} · {relativeTime(summary.generatedAt)}</div>
                </>
              ) : meta?.ai.enabled ? (
                <button onClick={writeSummary} disabled={busy} className="rounded border border-ai/30 px-2.5 py-1 text-[12px] text-ai hover:bg-ai/10 disabled:opacity-50">
                  {busy ? "Writing…" : "Describe today's moves"}
                </button>
              ) : (
                <p className="text-[12px] text-muted">AI is turned off.</p>
              )}
              {aiErr && <p className="mt-1 text-[12px] text-danger">{aiErr}</p>}
              <p className="mt-1.5 text-[10.5px] leading-snug text-faint">Describes moves from the numbers shown; never recommends trades or predicts prices.</p>
            </section>
          </aside>
        </div>

        <section className="border-t border-line px-6 py-5">
          <div className="mb-2 flex items-baseline justify-between">
            <h3 className="meta text-faint">World events with market exposure · last 24 h</h3>
            <span className="text-[11px] text-faint">Rule-based links, corroborated events only — not a forecast or trading signal</span>
          </div>
          {movers.length === 0 && <p className="text-[12px] text-faint">No qualifying events right now.</p>}
          <ul className="grid grid-cols-2 gap-x-6">
            {movers.map(({ event: e, exposure }) => (
              <li key={e.id} className="border-b border-line py-2">
                <button onClick={() => pick(e)} className="w-full text-left">
                  <div className="flex items-center gap-2">
                    <span className="meta" style={{ color: CATEGORIES[e.type].color }}>{CATEGORIES[e.type].label}</span>
                    <StatusBadge status={e.status} />
                    <span className="meta ml-auto text-faint normal-case tracking-normal">{relativeTime(e.timestamp)}</span>
                  </div>
                  <div className="mt-0.5 line-clamp-1 text-[13px] hover:text-accent">{e.title}</div>
                </button>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {exposure.map((x) => (
                    <ExposureChip key={x.symbol} link={x} quote={bySymbol.get(x.symbol)} />
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

export function ExposureChip({ link, quote }: { link: ExposureLink; quote?: Quote }) {
  const ch = quote ? formatChange(quote) : null;
  const color = ch && ch.dir > 0 ? UP : ch && ch.dir < 0 ? DOWN : "var(--text-muted)";
  return (
    <button
      onClick={() => useUI.getState().openInstrument(link.symbol)}
      title={`${link.rationale} — open ${link.symbol}`}
      className={clsx("inline-flex items-center gap-1.5 rounded border border-line px-1.5 py-0.5 text-[11px] hover:border-line-strong")}
    >
      <span className="text-fg/90">{link.name}</span>
      {ch && ch.text !== "—" && (
        <span className="tabular" style={{ color }}>
          {ch.dir > 0 ? "▲" : ch.dir < 0 ? "▼" : "■"} {ch.text}
        </span>
      )}
    </button>
  );
}
