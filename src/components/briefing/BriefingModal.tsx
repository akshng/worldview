"use client";
/**
 * Daily briefing view. Every line is an event from the store (clickable);
 * the optional AI summary is shown separately and labelled as interpretation.
 */
import clsx from "clsx";
import { useEffect, useState } from "react";
import { api, type BriefingItem, type DailyBriefing } from "@/lib/client/api";
import { useUI } from "@/lib/store/ui";
import { useData } from "@/lib/client/data-store";
import { CATEGORIES } from "@/lib/categories";
import { relativeTime } from "@/lib/time";
import { CloseIcon, SparkIcon } from "@/components/ui/icons";
import { ImportanceMeter } from "@/components/ui/primitives";
import { focusEvent } from "@/components/event-feed/EventFeed";

const CHANGE_STYLE: Record<BriefingItem["change"], { label: string; cls: string }> = {
  NEW: { label: "New", cls: "text-accent border-accent/40" },
  DEVELOPING: { label: "Developing", cls: "text-warn border-warn/40" },
  ONGOING: { label: "Ongoing", cls: "text-muted border-line-strong" },
  RESOLVED: { label: "Resolved", cls: "text-live border-live/40" },
};

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

export function BriefingModal() {
  const open = useUI((s) => s.briefingOpen);
  const setOpen = useUI((s) => s.setBriefingOpen);
  const meta = useData((s) => s.meta);
  const [data, setData] = useState<DailyBriefing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [narrative, setNarrative] = useState<DailyBriefing["aiNarrative"]>(null);
  const [busy, setBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const ctrl = new AbortController();
    api
      .briefing(ctrl.signal)
      .then((b) => {
        setData(b);
        setNarrative(b.aiNarrative);
        setError(null);
      })
      .catch((e) => e.name !== "AbortError" && setError(e.message));
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => {
      ctrl.abort();
      window.removeEventListener("keydown", onKey);
    };
  }, [open, setOpen]);

  if (!open) return null;

  const pick = (it: BriefingItem) => {
    setOpen(false);
    focusEvent(it.event);
  };

  const generate = async () => {
    setBusy(true);
    setAiError(null);
    try {
      setNarrative(await api.briefingNarrative());
    } catch (e) {
      setAiError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const maxCmp = Math.max(1, ...(data?.comparison ?? []).flatMap((c) => [c.today, c.yesterday]));

  return (
    <div className="fixed inset-0 z-50 flex justify-center overflow-y-auto bg-black/60 py-10" onMouseDown={() => setOpen(false)}>
      <div className="glass h-fit w-[880px] rounded-lg shadow-2xl shadow-black/60" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Daily briefing">
        <div className="flex items-start justify-between border-b border-line px-7 pt-6 pb-5">
          <div>
            <div className="meta text-accent">{greeting()}</div>
            <h2 className="mt-1 text-[22px] font-semibold tracking-tight">{data?.greeting ?? "World briefing"}</h2>
            {data && (
              <div className="mt-3 flex flex-wrap gap-2">
                {(Object.keys(data.changes) as Array<keyof DailyBriefing["changes"]>).map((k) => (
                  <span key={k} className={clsx("meta rounded-sm border px-2 py-0.5", CHANGE_STYLE[k].cls)}>
                    {data.changes[k]} {CHANGE_STYLE[k].label}
                  </span>
                ))}
                <span className="meta px-1 py-0.5 text-faint normal-case tracking-normal">in the last 24 hours · generated {relativeTime(data.generatedAt)}</span>
              </div>
            )}
          </div>
          <button onClick={() => setOpen(false)} className="rounded p-1 text-muted hover:bg-panel-hover hover:text-fg" aria-label="Close briefing">
            <CloseIcon />
          </button>
        </div>

        {error && <p className="px-7 py-6 text-[13px] text-danger">{error}</p>}
        {!data && !error && <p className="px-7 py-6 text-[13px] text-muted">Building briefing…</p>}

        {data && (
          <div className="px-7 py-5">
            {/* AI summary — separate from the factual list below */}
            <section className="mb-6 rounded-md border border-ai/25 bg-ai-soft px-4 py-3">
              <div className="mb-1.5 flex items-center justify-between">
                <h3 className="meta flex items-center gap-1.5 text-ai"><SparkIcon width={12} height={12} /> AI summary</h3>
                <span className="meta text-ai/60">Interpretation — not verified fact</span>
              </div>
              {narrative ? (
                <>
                  <p className="text-[13px] leading-relaxed whitespace-pre-line text-fg/85">{narrative.text}</p>
                  <div className="meta mt-2 normal-case tracking-normal text-faint">
                    {narrative.provider} · {narrative.model} · {relativeTime(narrative.generatedAt)} — written only from the events listed below
                  </div>
                </>
              ) : meta?.ai.enabled ? (
                <button onClick={generate} disabled={busy} className="rounded border border-ai/30 px-2.5 py-1 text-[12px] text-ai hover:bg-ai/10 disabled:opacity-50">
                  {busy ? "Writing summary…" : "Write AI summary of this briefing"}
                </button>
              ) : (
                <p className="text-[12px] text-muted">AI is not configured. The briefing below is built entirely from source data.</p>
              )}
              {aiError && <p className="mt-2 text-[12px] text-danger">{aiError}</p>}
            </section>

            <Section title="Top developments">
              {data.topDevelopments.length === 0 && <Empty />}
              <ol className="space-y-1">
                {data.topDevelopments.map((it, i) => (
                  <li key={it.event.id}>
                    <Row it={it} index={i + 1} onPick={pick} />
                  </li>
                ))}
              </ol>
            </Section>

            <Section title="What changed since yesterday">
              {data.historyDays < 2 && (
                <p className="mb-2 text-[11.5px] text-warn">
                  Partial comparison: WorldView has collected {data.historyDays} day(s) of history so far. Some feeds only provide recent records.
                </p>
              )}
              <div className="grid grid-cols-2 gap-x-8 gap-y-1.5">
                {data.comparison.map((c) => {
                  const delta = c.today - c.yesterday;
                  return (
                    <div key={c.category} className="flex items-center gap-2 text-[12px]">
                      <span className="w-24 shrink-0 text-muted">{c.label}</span>
                      <span className="flex flex-1 flex-col gap-[3px]">
                        <span className="h-1.5 rounded-full" style={{ width: `${(c.today / maxCmp) * 100}%`, background: CATEGORIES[c.category as keyof typeof CATEGORIES]?.color }} />
                        <span className="h-1 rounded-full bg-white/15" style={{ width: `${(c.yesterday / maxCmp) * 100}%` }} />
                      </span>
                      <span className="tabular w-20 text-right">
                        {c.today} <span className={clsx("text-[11px]", delta > 0 ? "text-warn" : delta < 0 ? "text-live" : "text-faint")}>({delta >= 0 ? "+" : ""}{delta})</span>
                      </span>
                    </div>
                  );
                })}
              </div>
              <p className="meta mt-2 normal-case tracking-normal text-faint">Coloured bar: last 24 h · grey bar: previous 24 h</p>
            </Section>

            <div className="grid grid-cols-2 gap-x-8">
              {data.sections.map((s) => (
                <Section key={s.id} title={s.title}>
                  {s.items.length === 0 ? <Empty /> : s.items.map((it) => <Row key={it.event.id} it={it} onPick={pick} compact />)}
                </Section>
              ))}
            </div>

            <Section title="What to watch">
              {data.whatToWatch.length === 0 ? <Empty text="No scheduled or still-active alerts." /> : data.whatToWatch.map((it) => <Row key={it.event.id} it={it} onPick={pick} upcoming />)}
            </Section>
          </div>
        )}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-6">
      <h3 className="meta mb-2 border-b border-line pb-1.5 text-faint">{title}</h3>
      {children}
    </section>
  );
}

function Empty({ text = "Nothing significant recorded." }: { text?: string }) {
  return <p className="text-[12px] text-faint">{text}</p>;
}

function Row({ it, index, onPick, compact, upcoming }: { it: BriefingItem; index?: number; onPick: (it: BriefingItem) => void; compact?: boolean; upcoming?: boolean }) {
  const e = it.event;
  const c = CATEGORIES[e.type];
  return (
    <button onClick={() => onPick(it)} className="flex w-full items-start gap-3 rounded px-2 py-1.5 text-left hover:bg-panel-hover">
      {index !== undefined && <span className="tabular w-4 pt-0.5 text-[13px] text-faint">{index}</span>}
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="meta" style={{ color: c.color }}>{c.label}</span>
          {!upcoming && <span className={clsx("meta rounded-sm border px-1 leading-4", CHANGE_STYLE[it.change].cls)}>{CHANGE_STYLE[it.change].label}</span>}
        </span>
        <span className={clsx("mt-0.5 block leading-snug", compact ? "line-clamp-1 text-[12.5px]" : "text-[13.5px] font-medium")}>{e.title}</span>
        <span className="meta mt-0.5 block normal-case tracking-[0.02em] text-faint">
          {[e.countryName ?? e.locationName, relativeTime(e.timestamp), `${e.sourceCount} source${e.sourceCount === 1 ? "" : "s"}`].filter(Boolean).join(" · ")}
        </span>
      </span>
      {!compact && <ImportanceMeter score={e.importanceScore} />}
    </button>
  );
}
