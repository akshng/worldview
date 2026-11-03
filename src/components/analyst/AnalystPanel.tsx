"use client";
/**
 * AI analyst: a chat drawer that answers questions from the app's own data
 * (tools over events, markets, macro, filings…), showing each tool call live
 * and the sources every answer was built from. Information only, not advice.
 */
import { usePageMode } from "@/components/layout/page-mode";
import { useCallback, useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { useUI } from "@/lib/store/ui";
import { useData } from "@/lib/client/data-store";
import { focusEvent } from "@/components/event-feed/EventFeed";
import { CloseIcon, SparkIcon } from "@/components/ui/icons";
import { SafeLink } from "@/components/ui/primitives";
import { ANALYST_DISCLAIMER, type AnalystStreamEvent, type Citation, type CitationAction } from "@/lib/analyst/types";

interface Step {
  n: number;
  call: string;
  done: boolean;
  ok: boolean;
  summary: string;
  ms: number;
}

interface Turn {
  id: number;
  role: "user" | "assistant";
  /** User question, or the answer body (without the source list) */
  text: string;
  kind?: "chat" | "desk-note";
  steps: Step[];
  status: string | null;
  citations: Citation[];
  model: string | null;
  mode: string | null;
  ms: number | null;
  error: string | null;
  pending: boolean;
}

const SUGGESTIONS = ["What's driving oil prices today?", "Give me a rundown on NVDA", "Which world events could affect my watchlist?", "How is the yield curve shaped and what data is due this week?", "Any shipping chokepoint disruptions right now?"];

/** Answer text without the appended source list and disclaimer (shown separately). */
const bodyOf = (text: string) => text.split(/\n\nSources:/)[0].replace(new RegExp(`\\s*${ANALYST_DISCLAIMER.replace(/[.]/g, "\\.")}\\s*$`), "").trim();

let nextId = 1;

export function AnalystPanel() {
  const page = usePageMode();
  const open = useUI((s) => s.analystOpen) || page;
  const setOpen = useUI((s) => s.setAnalystOpen);
  const watchlist = useUI((s) => s.settings.watchlist);
  const ai = useData((s) => s.meta?.ai);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !useUI.getState().instrument && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [turns]);

  const patch = (id: number, fn: (t: Turn) => Turn) => setTurns((ts) => ts.map((t) => (t.id === id ? fn(t) : t)));

  const run = useCallback(
    async (path: "chat" | "desk-note", question: string) => {
      if (busy) return;
      const history = turns.filter((t) => !t.pending && !t.error && t.text).map((t) => ({ role: t.role, content: t.text.slice(0, 4000) }));
      const userTurn: Turn = { id: nextId++, role: "user", text: question, kind: path === "desk-note" ? "desk-note" : "chat", steps: [], status: null, citations: [], model: null, mode: null, ms: null, error: null, pending: false };
      const a: Turn = { id: nextId++, role: "assistant", text: "", kind: path === "desk-note" ? "desk-note" : "chat", steps: [], status: "Starting…", citations: [], model: null, mode: null, ms: null, error: null, pending: true };
      setTurns((ts) => [...ts, userTurn, a]);
      setBusy(true);
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      try {
        const body = path === "chat" ? { messages: [...history, { role: "user", content: question }].slice(-12), watchlist } : { watchlist };
        const res = await fetch(`/api/analyst/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: ctrl.signal });
        if (!res.ok || !res.body) {
          const j = await res.json().catch(() => null);
          throw new Error(j?.error ?? `HTTP ${res.status}`);
        }
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let nl: number;
          while ((nl = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (!line) continue;
            let e: AnalystStreamEvent;
            try {
              e = JSON.parse(line);
            } catch {
              continue;
            }
            apply(a.id, e);
          }
        }
      } catch (err) {
        if ((err as Error).name === "AbortError") patch(a.id, (t) => ({ ...t, error: t.text ? null : "Stopped.", pending: false, status: null }));
        else patch(a.id, (t) => ({ ...t, error: (err as Error).message, pending: false, status: null }));
      } finally {
        patch(a.id, (t) => (t.pending ? { ...t, pending: false, status: null, error: t.error ?? (t.text ? null : "The stream ended without an answer.") } : t));
        setBusy(false);
        abortRef.current = null;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [busy, turns, watchlist],
  );

  function apply(id: number, e: AnalystStreamEvent) {
    switch (e.type) {
      case "start":
        return patch(id, (t) => ({ ...t, model: `${e.provider} · ${e.model}`, mode: e.mode, status: e.mode === "routed" ? "Gathering data…" : "Thinking…" }));
      case "status":
        return e.text ? patch(id, (t) => ({ ...t, status: e.text })) : undefined;
      case "step":
        return patch(id, (t) => ({ ...t, status: `Calling ${e.call}…`, steps: [...t.steps, { n: e.n, call: e.call, done: false, ok: true, summary: "", ms: 0 }] }));
      case "tool_result":
        return patch(id, (t) => ({ ...t, steps: t.steps.map((s) => (s.n === e.n ? { ...s, done: true, ok: e.ok, summary: e.summary, ms: e.ms } : s)) }));
      case "answer_delta":
        return patch(id, (t) => ({ ...t, text: t.text + e.text, status: null }));
      case "answer":
        return patch(id, (t) => ({ ...t, text: bodyOf(e.text), citations: e.citations, ms: e.ms, pending: false, status: null }));
      case "error":
        return patch(id, (t) => ({ ...t, error: e.message, pending: false, status: null }));
    }
  }

  const send = (q = input) => {
    const question = q.trim();
    if (!question || busy) return;
    setInput("");
    void run("chat", question);
  };

  if (!open) return null;
  return (
    <aside className={page ? "mx-auto flex h-full w-full max-w-[920px] flex-col border-x border-line bg-panel-solid" : "fixed top-12 right-0 bottom-0 z-40 flex w-[460px] max-w-full flex-col border-l border-line bg-panel-solid shadow-2xl shadow-black/60"} role="dialog" aria-label="AI analyst">
      <div className="flex items-start justify-between gap-3 border-b border-line px-4 pt-3.5 pb-3">
        <div className="min-w-0">
          <div className="meta flex items-center gap-1.5 text-ai">
            <SparkIcon width={12} height={12} /> Analyst <span className="rounded-sm border border-ai/40 px-1 py-[0.5px] text-[9.5px]">AI</span>
          </div>
          <p className="mt-1 text-[11.5px] leading-snug text-muted">Answers from WorldView&apos;s own data, with sources. AI-written: check the cited data. {ANALYST_DISCLAIMER}</p>
          <p className="meta mt-1 truncate normal-case tracking-normal text-faint" title="Model answering">
            {ai?.enabled ? `Model: ${ai.provider} · ${ai.model}` : (ai?.reason ?? "AI status unknown")}
          </p>
        </div>
        {!page && (
          <button onClick={() => setOpen(false)} className="shrink-0 rounded-md p-1.5 text-muted hover:bg-panel-hover hover:text-fg" title="Close (Esc)" aria-label="Close analyst">
          <CloseIcon />
        </button>
        )}
      </div>

      <div ref={listRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {turns.length === 0 && (
          <div className="space-y-2">
            <p className="text-[12px] text-muted">Ask about markets, companies, macro data or world events. The analyst pulls quotes, events, filings, positioning and more, then cites what it used.</p>
            <div className="flex flex-wrap gap-1.5">
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => send(s)} disabled={!ai?.enabled} className="rounded-full border border-line px-2.5 py-1 text-left text-[11.5px] text-muted hover:border-ai/40 hover:text-fg disabled:opacity-50">
                  {s}
                </button>
              ))}
            </div>
            {ai?.provider === "local" && <p className="text-[11px] text-faint">Runs on the on-device model: an answer can take a minute or two.</p>}
          </div>
        )}
        {turns.map((t) => (t.role === "user" ? <UserBubble key={t.id} turn={t} /> : <AnswerCard key={t.id} turn={t} />))}
      </div>

      <div className="border-t border-line px-4 pt-2.5 pb-3">
        <div className="flex gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            rows={2}
            maxLength={2000}
            placeholder={ai?.enabled ? "Ask the analyst…" : "AI is turned off"}
            disabled={!ai?.enabled}
            className="min-w-0 flex-1 resize-none rounded-md border border-line bg-bg/60 px-2.5 py-1.5 text-[12.5px] outline-none placeholder:text-faint focus:border-ai/50"
          />
          <div className="flex flex-col gap-1.5">
            {busy ? (
              <button onClick={() => abortRef.current?.abort()} className="rounded-md border border-line px-3 py-1 text-[12px] text-muted hover:text-fg">
                Stop
              </button>
            ) : (
              <button onClick={() => send()} disabled={!input.trim() || !ai?.enabled} className="rounded-md border border-ai/40 bg-ai/10 px-3 py-1 text-[12px] text-ai hover:bg-ai/20 disabled:opacity-40">
                Ask
              </button>
            )}
            <button
              onClick={() => void run("desk-note", watchlist.length ? `Desk note for my watchlist: ${watchlist.join(", ")}` : "Desk note (watchlist is empty: market-wide)")}
              disabled={busy || !ai?.enabled}
              title="A digest of your watchlist: moves, related events, earnings and data releases"
              className="rounded-md border border-line px-2 py-1 text-[11px] text-muted hover:text-fg disabled:opacity-40"
            >
              Desk note
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}

function UserBubble({ turn }: { turn: Turn }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] rounded-lg bg-accent-soft px-3 py-1.5 text-[12.5px] text-fg">{turn.text}</div>
    </div>
  );
}

function AnswerCard({ turn }: { turn: Turn }) {
  return (
    <div className="rounded-md border border-ai/25 bg-ai-soft px-3 py-2.5">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="meta flex items-center gap-1.5 text-ai">
          <SparkIcon width={11} height={11} /> {turn.kind === "desk-note" ? "Desk note" : "Analyst"} · AI
        </span>
        <span className="meta truncate normal-case tracking-normal text-faint">
          {turn.model}
          {turn.ms !== null && ` · ${(turn.ms / 1000).toFixed(1)} s`}
        </span>
      </div>

      {turn.steps.length > 0 && (
        <ol className="mb-2 space-y-0.5">
          {turn.steps.map((s) => (
            <li key={s.n} className="flex items-baseline gap-1.5 text-[11px]">
              <span className={clsx("w-3 shrink-0 text-center", !s.done ? "animate-pulse text-ai" : s.ok ? "text-ai" : "text-danger")}>{!s.done ? "•" : s.ok ? "✓" : "✗"}</span>
              <span className="truncate font-mono text-[10.5px] text-muted" title={s.call}>
                {s.call}
              </span>
              {s.done && (
                <span className={clsx("ml-auto shrink-0 truncate pl-1", s.ok ? "text-faint" : "text-danger")} title={s.summary}>
                  {s.summary.slice(0, 40)}
                  {s.ms > 0 && ` · ${s.ms < 1000 ? `${s.ms} ms` : `${(s.ms / 1000).toFixed(1)} s`}`}
                </span>
              )}
            </li>
          ))}
        </ol>
      )}

      {turn.status && <p className="animate-pulse text-[11.5px] text-muted">{turn.status}</p>}
      {turn.text && <AnswerText text={turn.text} citations={turn.citations} />}
      {turn.error && <p className="mt-1 text-[12px] text-danger">{turn.error}</p>}

      {!turn.pending && <ShowOnMap citations={turn.citations} />}
      {turn.citations.length > 0 && <Sources citations={turn.citations} />}
      {!turn.pending && turn.text && <p className="meta mt-1.5 normal-case tracking-normal text-faint">AI-generated from the sources above · {ANALYST_DISCLAIMER}</p>}
    </div>
  );
}

/** Plot every event the answer drew on, on its own, on the globe. */
function ShowOnMap({ citations }: { citations: Citation[] }) {
  const ids = [...new Set(citations.flatMap((c) => c.actions.flatMap((a) => (a.kind === "event" ? [a.id] : []))))];
  if (!ids.length) return null;
  const label = citations.find((c) => c.actions.some((a) => a.kind === "event"))?.call ?? "Analyst answer";
  return (
    <button
      onClick={() => useUI.getState().setPlot({ ids, label: `from the Analyst (${label})` })}
      className="mt-2 rounded-md border border-line px-2 py-1 text-[12px] text-accent hover:border-line-strong hover:bg-panel-hover"
      title="Open the globe showing only these events"
    >
      Show {ids.length} on map
    </button>
  );
}

/** Answer text with [S1] markers rendered as small source chips. */
function AnswerText({ text, citations }: { text: string; citations: Citation[] }) {
  const parts = text.split(/(\[S\d+(?:\s*,\s*S\d+)*\])/g);
  return (
    <p className="text-[12.5px] leading-relaxed whitespace-pre-line text-fg/90">
      {parts.map((p, i) => {
        const m = p.match(/^\[(S\d+(?:\s*,\s*S\d+)*)\]$/);
        if (!m) return <span key={i}>{p}</span>;
        return m[1].split(/\s*,\s*/).map((id) => {
          const c = citations.find((x) => x.id === id);
          return (
            <sup key={`${i}-${id}`} className="mx-[1px] cursor-help rounded-sm bg-ai/15 px-[3px] text-[9.5px] text-ai" title={c ? `${c.call} — ${c.source}${c.asOf ? ` (as of ${c.asOf})` : ""}` : id}>
              {id}
            </sup>
          );
        });
      })}
    </p>
  );
}

function runAction(a: CitationAction) {
  const ui = useUI.getState();
  if (a.kind === "instrument") return ui.openInstrument(a.symbol); // modal above the drawer
  // The event / country panel sits where the drawer is: hide the drawer (the chat is kept).
  ui.setAnalystOpen(false);
  if (a.kind === "event") focusEvent({ id: a.id, latitude: a.lat, longitude: a.lon });
  else ui.selectCountry(a.code);
}

function Sources({ citations }: { citations: Citation[] }) {
  return (
    <details className="mt-2 rounded border border-line/70 bg-bg/40 px-2 py-1.5">
      <summary className="meta cursor-pointer text-faint hover:text-muted">Sources used ({citations.length})</summary>
      <ul className="mt-1.5 space-y-2">
        {citations.map((c) => (
          <li key={c.id} className="text-[11px] leading-snug">
            <div className="flex items-baseline gap-1.5">
              <span className="rounded-sm bg-ai/15 px-1 text-[9.5px] text-ai">{c.id}</span>
              <span className={clsx("font-mono text-[10.5px]", c.ok ? "text-fg/80" : "text-danger")}>{c.call}</span>
            </div>
            <div className="text-faint">
              {c.ok ? c.source : `Failed: ${c.source.replace(/^unavailable: /, "")}`}
              {c.asOf && ` · data as of ${c.asOf.replace("T", " ").slice(0, 16)}`} · fetched {c.fetchedAt.slice(11, 16)} UTC
            </div>
            {(c.actions.length > 0 || c.links.length > 0) && (
              <div className="mt-0.5 flex flex-wrap gap-1">
                {c.actions.map((a, i) => (
                  <button key={i} onClick={() => runAction(a)} className="rounded border border-line px-1.5 py-[1px] text-[10.5px] text-muted hover:border-accent/50 hover:text-accent" title={a.kind === "event" ? "Show on the globe" : a.kind === "instrument" ? "Open instrument" : "Open country"}>
                    {a.kind === "event" ? "◎ " : a.kind === "instrument" ? "↗ " : "⚑ "}
                    {a.label}
                  </button>
                ))}
                {c.links.map((l, i) => (
                  <SafeLink key={`l${i}`} href={l.url} className="rounded border border-line px-1.5 py-[1px] text-[10.5px] text-muted hover:text-accent">
                    {l.label} ↗
                  </SafeLink>
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}
