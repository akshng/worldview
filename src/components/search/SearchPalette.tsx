"use client";
import clsx from "clsx";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, type SearchResponse } from "@/lib/client/api";
import { useUI } from "@/lib/store/ui";
import { useData } from "@/lib/client/data-store";
import { CATEGORIES } from "@/lib/categories";
import { relativeTime } from "@/lib/time";
import { GlobeIcon, LayersIcon, PinIcon, SearchIcon, SparkIcon } from "@/components/ui/icons";
import { focusEvent } from "@/components/event-feed/EventFeed";
import type { EventCategory } from "@/types/events";

type Item =
  | { kind: "ask-ai"; data: null }
  | { kind: "intent"; data: NonNullable<SearchResponse["intent"]> }
  | { kind: "location"; data: SearchResponse["locations"][number] }
  | { kind: "event"; data: SearchResponse["events"][number] }
  | { kind: "topic"; data: SearchResponse["topics"][number] };

const EXAMPLES = ["Japan", "earthquakes over magnitude 5", "What is happening in Europe?", "California fires", "protests last 6 hours", "launches"];

export function SearchPalette() {
  const open = useUI((s) => s.searchOpen);
  const setOpen = useUI((s) => s.setSearchOpen);
  const [q, setQ] = useState("");
  const [res, setRes] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const [aiState, setAiState] = useState<{ q: string; busy: boolean; error: string | null }>({ q: "", busy: false, error: null });
  const aiEnabled = useData((s) => s.meta?.ai.enabled ?? false);
  const input = useRef<HTMLInputElement>(null);

  // ⌘K / Ctrl+K / "/" to open
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.closest("input, textarea, [contenteditable]");
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !typing)) {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setOpen]);

  useEffect(() => {
    if (open) setTimeout(() => input.current?.focus(), 10);
  }, [open]);

  // Debounced search
  useEffect(() => {
    const term = q.trim();
    if (!term) return;
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      setLoading(true);
      api
        .search(term, ctrl.signal)
        .then((r) => {
          setRes(r);
          setActive(0);
        })
        .catch(() => {})
        .finally(() => setLoading(false));
    }, 180);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q]);

  const items: Item[] = useMemo(() => {
    // Ignore stale results once the query is cleared.
    if (!res || !q.trim()) return [];
    const offerAI = aiEnabled && res.intent?.source !== "ai" && q.trim().split(/\s+/).length >= 3;
    return [
      ...(offerAI ? [{ kind: "ask-ai" as const, data: null }] : []),
      ...(res.intent ? [{ kind: "intent" as const, data: res.intent }] : []),
      ...res.locations.map((d) => ({ kind: "location" as const, data: d })),
      ...res.events.map((d) => ({ kind: "event" as const, data: d })),
      ...res.topics.map((d) => ({ kind: "topic" as const, data: d })),
    ];
  }, [res, q, aiEnabled]);

  if (!open) return null;

  const close = () => {
    setOpen(false);
    setQ("");
    setRes(null);
  };

  const askAI = async () => {
    const term = q.trim();
    setAiState({ q: term, busy: true, error: null });
    try {
      const r = await api.search(term, undefined, true);
      setRes(r);
      setActive(0);
      setAiState({ q: term, busy: false, error: null });
    } catch (e) {
      setAiState({ q: term, busy: false, error: (e as Error).message });
    }
  };

  const choose = (it: Item) => {
    if (it.kind === "ask-ai") return void askAI();
    const ui = useUI.getState();
    if (it.kind === "location") {
      const l = it.data;
      if (l.kind === "country" && l.code) ui.selectCountry(l.code);
      else ui.requestFlyTo({ lon: l.lon, lat: l.lat, zoom: l.zoom, bbox: l.bbox ?? undefined });
    } else if (it.kind === "event") {
      focusEvent(it.data);
    } else if (it.kind === "topic") {
      ui.setCategories(it.data.categories as EventCategory[]);
    } else {
      const i = it.data;
      if (i.categories.length) ui.setCategories(i.categories as EventCategory[]);
      if (i.range) ui.setRange(i.range as Parameters<typeof ui.setRange>[0]);
      if (i.place) {
        if (i.place.country) ui.selectCountry(i.place.country);
        else ui.requestFlyTo({ lon: i.place.lon, lat: i.place.lat, zoom: i.place.zoom });
      }
    }
    close();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") close();
    else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(items.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter" && items[active]) {
      e.preventDefault();
      choose(items[active]);
    }
  };

  const group = (kind: Item["kind"], title: string) => {
    const list = items.map((it, i) => ({ it, i })).filter(({ it }) => it.kind === kind);
    if (!list.length) return null;
    return (
      <div className="py-1.5">
        <div className="meta px-4 py-1 text-faint">{title}</div>
        {list.map(({ it, i }) => (
          <button
            key={i}
            onMouseEnter={() => setActive(i)}
            onClick={() => choose(it)}
            className={clsx("flex w-full items-center gap-3 px-4 py-2 text-left", active === i && "bg-panel-hover")}
          >
            <Row it={it} />
          </button>
        ))}
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-[12vh]" onMouseDown={close}>
      <div className="glass w-[620px] overflow-hidden rounded-lg shadow-2xl shadow-black/60" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Search">
        <div className="flex items-center gap-3 border-b border-line px-4">
          <SearchIcon className="text-faint" />
          <input
            ref={input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search countries, cities, events, topics…"
            className="h-12 flex-1 bg-transparent text-[14px] outline-none placeholder:text-faint"
            aria-label="Search query"
          />
          {loading && <span className="meta text-faint">Searching…</span>}
          <kbd className="meta rounded border border-line px-1.5 text-faint">Esc</kbd>
        </div>
        <div className="scroll-thin max-h-[56vh] overflow-y-auto">
          {!q.trim() && (
            <div className="p-4">
              <div className="meta mb-2 text-faint">Try</div>
              <div className="flex flex-wrap gap-1.5">
                {EXAMPLES.map((x) => (
                  <button key={x} onClick={() => setQ(x)} className="rounded border border-line px-2 py-1 text-[12px] text-muted hover:border-line-strong hover:text-fg">
                    {x}
                  </button>
                ))}
              </div>
              <p className="mt-4 text-[11.5px] leading-relaxed text-faint">
                Structured search: places, categories, time phrases (“last 6 hours”) and magnitudes are recognised. Natural-language questions will be routed to an AI command layer in a future version.
              </p>
            </div>
          )}
          {q.trim() && res?.query === q.trim() && items.length === 0 && <div className="p-6 text-center text-[12.5px] text-muted">No results for “{q}”.</div>}
          {group("ask-ai", "AI")}
          {aiState.q === q.trim() && aiState.busy && <div className="px-4 py-2 text-[12px] text-ai">Interpreting with AI…</div>}
          {aiState.q === q.trim() && aiState.error && <div className="px-4 py-2 text-[12px] text-danger">{aiState.error}</div>}
          {group("intent", "Interpretation")}
          {group("location", "Locations")}
          {group("event", "Events")}
          {group("topic", "Topics")}
        </div>
      </div>
    </div>
  );
}

function Row({ it }: { it: Item }) {
  if (it.kind === "ask-ai") {
    return (
      <>
        <SparkIcon className="shrink-0 text-ai" />
        <div className="min-w-0 flex-1">
          <div className="text-[13px] text-ai">Ask AI to interpret this question</div>
          <div className="meta normal-case tracking-[0.02em] text-faint">AI turns it into filters; results are real events from the database</div>
        </div>
      </>
    );
  }
  if (it.kind === "intent") {
    const byAI = it.data.source === "ai";
    return (
      <>
        <SparkIcon className={clsx("shrink-0", byAI ? "text-ai" : "text-accent")} />
        <div className="min-w-0 flex-1">
          <div className="text-[13px]">Apply filters: {it.data.description}</div>
          <div className="meta normal-case tracking-[0.02em] text-faint">
            {byAI ? `Interpreted by AI — ${it.data.explanation ?? "filters only"}` : "Sets layers / time range and moves the globe"}
          </div>
        </div>
      </>
    );
  }
  if (it.kind === "location") {
    return (
      <>
        {it.data.kind === "region" || it.data.kind === "country" ? <GlobeIcon className="shrink-0 text-muted" /> : <PinIcon className="shrink-0 text-muted" />}
        <div className="min-w-0 flex-1">
          <div className="text-[13px]">{it.data.name}</div>
          <div className="meta normal-case tracking-[0.02em] text-faint">{it.data.kind} · {it.data.detail}</div>
        </div>
      </>
    );
  }
  if (it.kind === "event") {
    const c = CATEGORIES[it.data.type];
    return (
      <>
        <span className="mx-[5px] h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: c.color }} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px]">{it.data.title}</div>
          <div className="meta normal-case tracking-[0.02em] text-faint">
            {c.label} · {it.data.countryName ?? it.data.locationName ?? "—"} · {relativeTime(it.data.timestamp)} · importance {it.data.importanceScore}
          </div>
        </div>
      </>
    );
  }
  return (
    <>
      <LayersIcon className="shrink-0 text-muted" />
      <div className="min-w-0 flex-1">
        <div className="text-[13px]">{it.data.label}</div>
        <div className="meta normal-case tracking-[0.02em] text-faint">Show only: {it.data.detail}</div>
      </div>
    </>
  );
}
