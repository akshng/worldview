"use client";
/**
 * Search any instrument on any exchange; open it, or add it to the watchlist.
 * Typing a raw symbol and pressing Enter still adds it directly.
 */
import clsx from "clsx";
import { useEffect, useId, useRef, useState } from "react";
import { api } from "@/lib/client/api";
import type { SearchHit } from "@/lib/finance/search";
import { useUI } from "@/lib/store/ui";

const SYMBOL = /^[A-Z0-9.^=\-]{1,15}$/;

export function TickerSearch({ watchlist, onAdd }: { watchlist: string[]; onAdd: (symbol: string) => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const openInstrument = useUI((s) => s.openInstrument);
  const box = useRef<HTMLDivElement>(null);
  const listId = useId();

  useEffect(() => {
    const term = q.trim();
    if (term.length < 1) return;
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      api
        .searchInstruments(term, ctrl.signal)
        .then((r) => {
          setHits(r.hits);
          setActive(0);
          setErr(null);
        })
        .catch((e) => e.name !== "AbortError" && setErr(e.message));
    }, 250);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q]);

  useEffect(() => {
    const close = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const shown = q.trim() ? hits : [];
  const add = (symbol: string) => {
    onAdd(symbol);
    setQ("");
    setHits([]);
    setOpen(false);
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") setActive((a) => Math.min(a + 1, shown.length - 1));
    else if (e.key === "ArrowUp") setActive((a) => Math.max(a - 1, 0));
    else if (e.key === "Escape") setOpen(false);
    else if (e.key === "Enter") {
      const pick = shown[active];
      if (pick) openInstrument(pick.symbol);
      else if (SYMBOL.test(q.trim().toUpperCase())) add(q.trim().toUpperCase());
    } else return;
    e.preventDefault();
  };

  return (
    <div ref={box} className="relative mb-2">
      <input
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKey}
        placeholder="Search any stock, ETF, index, currency, crypto…"
        aria-label="Search instruments"
        role="combobox"
        aria-controls={listId}
        aria-expanded={open && shown.length > 0}
        className="w-full rounded border border-line bg-bg-elev px-2 py-1 text-[12px] placeholder:text-faint"
      />
      {open && (shown.length > 0 || err) && (
        <ul id={listId} role="listbox" className="absolute z-20 mt-1 max-h-80 w-full overflow-auto rounded border border-line bg-panel-solid py-1 shadow-lg">
          {err && <li className="px-2 py-1 text-[12px] text-warn">Search unavailable: {err}</li>}
          {shown.map((h, i) => (
            <li key={h.symbol} role="option" aria-selected={i === active} onMouseEnter={() => setActive(i)} className={clsx("flex items-center gap-2 px-2 py-1", i === active && "bg-panel-hover")}>
              <button onClick={() => openInstrument(h.symbol)} className="min-w-0 flex-1 text-left" title={[h.sector, h.industry].filter(Boolean).join(" · ") || h.name}>
                <span className="text-[12px] font-medium">{h.symbol}</span> <span className="text-[11.5px] text-muted">{h.name}</span>
                <div className="text-[10.5px] text-faint">
                  {h.type}
                  {h.exchange ? ` · ${h.exchange}` : ""}
                  {h.sector ? ` · ${h.sector}` : ""}
                </div>
              </button>
              <button
                onClick={() => add(h.symbol)}
                disabled={watchlist.includes(h.symbol)}
                className="shrink-0 rounded border border-line px-1.5 text-[11px] text-muted hover:text-fg disabled:opacity-40"
                aria-label={`Add ${h.symbol} to watchlist`}
              >
                {watchlist.includes(h.symbol) ? "✓" : "+ Watch"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
