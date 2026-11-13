"use client";
/**
 * "Since you last looked": a dismissible card when the app opens, or when the World / News
 * page comes back after ≥ 2 h away. New high-importance events by category, the top 5,
 * notable watchlist moves today and newly posted stock setups. The last-visit time lives in
 * this browser only (localStorage).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { api, type Quote } from "@/lib/client/api";
import { notableMoves, readLastVisit, shouldShowDigest, writeLastVisit, type Digest } from "@/lib/client/digest";
import { CATEGORIES } from "@/lib/categories";
import { relativeTime } from "@/lib/time";
import { useUI } from "@/lib/store/ui";
import { CloseIcon } from "@/components/ui/icons";
import type { EventCategory } from "@/types/events";

const TICK_MS = 60_000;

interface Card {
  since: number;
  digest: Digest | null;
  moves: Quote[];
  error: string | null;
}

export function SinceLastVisit() {
  const view = useUI((s) => s.view);
  const [card, setCard] = useState<Card | null>(null);
  const opened = useRef(false);
  const firstVisit = useRef<number | null | undefined>(undefined);

  const open = useCallback((since: number) => {
    opened.current = true;
    setCard({ since, digest: null, moves: [], error: null });
    api.digest(since).then(
      (digest) => setCard((c) => (c && c.since === since ? { ...c, digest } : c)),
      (e: Error) => setCard((c) => (c && c.since === since ? { ...c, error: e.message } : c)),
    );
    const watch = useUI.getState().settings.watchlist;
    if (watch.length)
      api.quotes(watch.slice(0, 25)).then(
        (r) => setCard((c) => (c && c.since === since ? { ...c, moves: notableMoves(r.quotes).slice(0, 6) } : c)),
        () => {},
      );
  }, []);

  useEffect(() => {
    const visibleAndFocused = () => !document.hidden && document.hasFocus();
    // On open: show if the last visit was ≥ 2 h ago.
    // Read once per mount (the ref survives React's dev double-run, which would otherwise see "just now").
    if (firstVisit.current === undefined) firstVisit.current = readLastVisit();
    const last = firstVisit.current;
    const v = useUI.getState().view;
    const initial = shouldShowDigest(last) && (v === "world" || v === "news") && !opened.current ? setTimeout(() => open(last!), 0) : undefined;
    writeLastVisit();
    // While someone's looking, keep "last seen" fresh; time away is time hidden or unfocused.
    let lastSeen = Date.now();
    const mark = () => {
      if (visibleAndFocused()) {
        lastSeen = Date.now();
        writeLastVisit(lastSeen);
      }
    };
    const timer = setInterval(mark, TICK_MS);
    const onBack = () => {
      if (!visibleAndFocused()) return;
      const stored = readLastVisit() ?? lastSeen;
      const ui = useUI.getState();
      if (shouldShowDigest(stored) && (ui.view === "world" || ui.view === "news")) open(stored);
      mark();
    };
    const onLeave = () => writeLastVisit();
    document.addEventListener("visibilitychange", onBack);
    window.addEventListener("focus", onBack);
    window.addEventListener("pagehide", onLeave);
    window.addEventListener("blur", onLeave);
    return () => {
      clearTimeout(initial);
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onBack);
      window.removeEventListener("focus", onBack);
      window.removeEventListener("pagehide", onLeave);
      window.removeEventListener("blur", onLeave);
    };
  }, [open]);

  if (!card || (view !== "world" && view !== "news")) return null;
  const close = () => setCard(null);
  const d = card.digest;
  const nothing = d && !d.highCount && !d.setups.length && !card.moves.length;

  const openEvent = (e: Digest["top"][number]) => {
    const ui = useUI.getState();
    ui.selectEvent(e.id);
    if (ui.view === "world") ui.requestFlyTo({ lon: e.longitude, lat: e.latitude, zoom: 4.2 });
    close();
  };
  const openTicker = (symbol: string) => {
    useUI.getState().openInstrument(symbol);
    close();
  };

  return (
    <div className="pointer-events-none fixed inset-x-0 top-14 z-30 flex justify-center px-4">
      <section className="pointer-events-auto w-full max-w-[560px] rounded-lg border border-line bg-bg-elev p-4 shadow-2xl shadow-black/60" role="dialog" aria-label="Since you last looked">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="meta text-accent">Since you last looked</div>
            <div className="mt-0.5 text-[12px] text-faint">Away since {relativeTime(card.since)} · {new Date(card.since).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false })}</div>
          </div>
          <button onClick={close} className="rounded p-1 text-muted hover:bg-panel-hover hover:text-fg" aria-label="Dismiss">
            <CloseIcon width={14} height={14} />
          </button>
        </div>

        {card.error && <p className="mt-3 text-[12.5px] text-danger">{card.error}</p>}
        {!d && !card.error && <div className="mt-3 h-16 animate-pulse rounded bg-white/[0.03]" />}
        {nothing && <p className="mt-3 text-[12.5px] text-muted">Nothing major since then — no new high-importance events, notable watchlist moves or setups.</p>}

        {d && d.highCount > 0 && (
          <>
            <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[12px]">
              <span className="text-fg">
                <span className="tabular font-medium">{d.highCount}</span> new high-importance event{d.highCount === 1 ? "" : "s"}
              </span>
              {d.byCategory.slice(0, 8).map((c) => {
                const meta = CATEGORIES[c.type as EventCategory];
                return (
                  <span key={c.type} className="inline-flex items-center gap-1 rounded-sm bg-panel-hover px-1.5 py-[1px] text-muted">
                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: meta?.color ?? "var(--text-faint)" }} />
                    {meta?.layerLabel ?? c.type} <span className="tabular text-fg">{c.count}</span>
                  </span>
                );
              })}
            </div>
            <ul className="mt-2 divide-y divide-line">
              {d.top.map((e) => (
                <li key={e.id}>
                  <button onClick={() => openEvent(e)} className="flex w-full items-baseline gap-2 py-1.5 text-left hover:text-accent">
                    <span className="tabular w-6 shrink-0 text-[11.5px] text-muted">{Math.round(e.importanceScore)}</span>
                    <span className="min-w-0 flex-1 truncate text-[12.5px]">{e.title}</span>
                    <span className="shrink-0 text-[11px] text-faint">{e.where ? `${e.where} · ` : ""}{relativeTime(e.timestamp)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}

        {card.moves.length > 0 && (
          <div className="mt-3">
            <div className="meta text-faint">Watchlist moves today</div>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {card.moves.map((q) => (
                <button key={q.symbol} onClick={() => openTicker(q.symbol)} className="rounded border border-line px-2 py-0.5 text-[12px] hover:border-line-strong" title={`Open ${q.symbol}`}>
                  <span className="font-medium">{q.symbol}</span>{" "}
                  <span className={q.changePct! >= 0 ? "text-live" : "text-danger"}>
                    {q.changePct! >= 0 ? "▲ +" : "▼ "}
                    {q.changePct!.toFixed(2)}%
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {d && d.setups.length > 0 && (
          <div className="mt-3">
            <div className="meta text-faint">New stock setups <span className="normal-case tracking-normal">· rule-based screen, not advice</span></div>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {d.setups.map((s) => (
                <button key={`${s.date}-${s.symbol}`} onClick={() => openTicker(s.symbol)} className="rounded border border-line px-2 py-0.5 text-[12px] hover:border-line-strong" title={s.signals.join(" · ")}>
                  <span className="font-medium">{s.symbol}</span> <span className="text-faint">{s.date.slice(5)}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
