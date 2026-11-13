"use client";
/**
 * Settings → Alerts: user-defined alert rules posted to Discord by the server (and the
 * battery sentinel). Rules live on the server (DATA_DIR/alert-rules.json) so background
 * jobs can use them. "Test" previews matches in the last 24 h without posting anything.
 */
import clsx from "clsx";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/client/api";
import { CATEGORY_LIST, CATEGORIES } from "@/lib/categories";
import type { AlertRule } from "@/lib/notify/rules";
import type { EventCategory } from "@/types/events";

type Draft = AlertRule;
type TestResult = Awaited<ReturnType<typeof api.testAlertRule>> | { error: string } | "running";

const newId = () => `r-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const blank = (): Draft => ({ id: newId(), name: "New rule", enabled: true, minImportance: 60 });

function describeRule(r: Draft, sourceName: (id: string) => string): string {
  const parts: string[] = [];
  if (r.types?.length) parts.push(r.types.map((t) => CATEGORIES[t]?.label ?? t).join(" or "));
  if (r.countries?.length) parts.push(`in ${r.countries.join(", ")}`);
  if (r.sources?.length) parts.push(`from ${r.sources.map(sourceName).join(", ")}`);
  if (r.keywords?.length) parts.push(`mentioning ${r.keywords.map((k) => `“${k}”`).join(" or ")}`);
  if (r.minImportance !== undefined) parts.push(`importance ≥ ${r.minImportance}`);
  return parts.length ? parts.join(" · ") : "No filters yet — add at least one";
}

function Chips({ values, label, onRemove }: { values: string[]; label: (v: string) => string; onRemove: (v: string) => void }) {
  if (!values.length) return null;
  return (
    <div className="mt-1.5 flex flex-wrap gap-1">
      {values.map((v) => (
        <span key={v} className="inline-flex items-center gap-1 rounded-sm bg-panel-hover px-1.5 py-[1px] text-[11.5px]">
          {label(v)}
          <button onClick={() => onRemove(v)} className="text-faint hover:text-fg" aria-label={`Remove ${label(v)}`}>
            ×
          </button>
        </span>
      ))}
    </div>
  );
}

function RuleEditor({
  rule,
  onChange,
  onDelete,
  sources,
  countries,
}: {
  rule: Draft;
  onChange: (r: Draft) => void;
  onDelete: () => void;
  sources: Array<{ id: string; name: string }>;
  countries: Array<{ code: string; name: string }>;
}) {
  const [open, setOpen] = useState(false);
  const [kw, setKw] = useState("");
  const [test, setTest] = useState<TestResult | null>(null);
  const srcName = (id: string) => sources.find((s) => s.id === id)?.name ?? id;
  const ctyName = (c: string) => countries.find((x) => x.code === c)?.name ?? c;
  const set = (patch: Partial<Draft>) => {
    setTest(null);
    const next = { ...rule, ...patch };
    for (const k of ["types", "countries", "sources", "keywords"] as const) if (next[k] && !next[k]!.length) delete next[k];
    onChange(next);
  };
  const add = <K extends "countries" | "sources" | "keywords">(k: K, v: string) => {
    const cur = (rule[k] ?? []) as string[];
    if (v && !cur.includes(v)) set({ [k]: [...cur, v] } as Partial<Draft>);
  };
  const remove = <K extends "countries" | "sources" | "keywords">(k: K, v: string) => set({ [k]: ((rule[k] ?? []) as string[]).filter((x) => x !== v) } as Partial<Draft>);
  const addKeywords = () => {
    const words = kw.split(",").map((w) => w.trim()).filter((w) => w.length >= 2);
    if (words.length) set({ keywords: [...new Set([...(rule.keywords ?? []), ...words])].slice(0, 20) });
    setKw("");
  };
  const runTest = () => {
    setTest("running");
    api.testAlertRule(rule).then(setTest, (e: Error) => setTest({ error: e.message }));
  };

  return (
    <div className={clsx("rounded-md border border-line", !rule.enabled && "opacity-60")}>
      <div className="flex items-center gap-3 px-3 py-2.5">
        <button
          role="switch"
          aria-checked={rule.enabled}
          aria-label={`Enable ${rule.name}`}
          onClick={() => set({ enabled: !rule.enabled })}
          className={clsx("relative h-5 w-9 shrink-0 rounded-full transition-colors", rule.enabled ? "bg-accent/70" : "bg-white/12")}
        >
          <span className={clsx("absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all", rule.enabled ? "left-[18px]" : "left-0.5")} />
        </button>
        <button onClick={() => setOpen((v) => !v)} className="min-w-0 flex-1 text-left">
          <div className="truncate text-[13px] font-medium">{rule.name || "Untitled rule"}</div>
          <div className="truncate text-[11.5px] text-faint">{describeRule(rule, srcName)}</div>
        </button>
        <button onClick={runTest} className="rounded border border-line px-2 py-0.5 text-[11.5px] text-muted hover:text-fg" title="How many of the last 24 h's events match (nothing is posted)">
          Test
        </button>
        <button onClick={() => setOpen((v) => !v)} className="rounded border border-line px-2 py-0.5 text-[11.5px] text-muted hover:text-fg">
          {open ? "Done" : "Edit"}
        </button>
        <button onClick={onDelete} className="rounded border border-line px-2 py-0.5 text-[11.5px] text-muted hover:border-danger/50 hover:text-danger" aria-label={`Delete ${rule.name}`}>
          Delete
        </button>
      </div>

      {test && (
        <div className="border-t border-line px-3 py-2 text-[12px]">
          {test === "running" ? (
            <span className="text-faint">Testing against the last 24 hours…</span>
          ) : "error" in test ? (
            <span className="text-danger">{test.error}</span>
          ) : (
            <>
              <div className="text-muted">
                <span className="tabular text-fg">{test.matched.toLocaleString("en-US")}</span> of {test.total.toLocaleString("en-US")} events in the last 24 h match
                <span className="text-faint"> · preview only, nothing posted. Live alerts cover events first seen after the rule was saved, at most a few per check.</span>
              </div>
              {test.sample.length > 0 && (
                <ul className="mt-1 space-y-0.5">
                  {test.sample.map((e) => (
                    <li key={e.id} className="truncate text-[11.5px] text-faint">
                      <span className="tabular text-muted">{Math.round(e.importanceScore)}</span> · {e.title}
                      {e.countryName ? ` — ${e.countryName}` : ""}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      )}

      {open && (
        <div className="space-y-3 border-t border-line px-3 py-3 text-[12.5px]">
          <label className="block">
            <span className="meta text-faint">Name</span>
            <input value={rule.name} maxLength={80} onChange={(e) => set({ name: e.target.value })} className="mt-1 block w-full rounded border border-line bg-bg-elev px-2 py-1" />
          </label>

          <div>
            <span className="meta text-faint">Types (any)</span>
            <div className="mt-1 flex flex-wrap gap-1">
              {CATEGORY_LIST.map((c) => {
                const on = rule.types?.includes(c.id) ?? false;
                return (
                  <button
                    key={c.id}
                    onClick={() => set({ types: on ? rule.types!.filter((t) => t !== c.id) : [...(rule.types ?? []), c.id as EventCategory] })}
                    aria-pressed={on}
                    className={clsx("rounded-sm border px-1.5 py-[1px] text-[11.5px]", on ? "border-transparent text-bg" : "border-line text-muted hover:text-fg")}
                    style={on ? { background: c.color } : undefined}
                  >
                    {c.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <span className="meta text-faint">Countries (any)</span>
              <select aria-label="Add country" value="" onChange={(e) => add("countries", e.target.value)} className="mt-1 block w-full rounded border border-line bg-bg-elev px-2 py-1">
                <option value="">Add a country…</option>
                {countries.filter((c) => /^[A-Z]{2}$/.test(c.code)).map((c) => (
                  <option key={c.code} value={c.code}>{c.name}</option>
                ))}
              </select>
              <Chips values={rule.countries ?? []} label={ctyName} onRemove={(v) => remove("countries", v)} />
            </div>
            <div>
              <span className="meta text-faint">Sources (any)</span>
              <select aria-label="Add source" value="" onChange={(e) => add("sources", e.target.value)} className="mt-1 block w-full rounded border border-line bg-bg-elev px-2 py-1">
                <option value="">Add a source…</option>
                {sources.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
              <Chips values={rule.sources ?? []} label={srcName} onRemove={(v) => remove("sources", v)} />
            </div>
          </div>

          <div>
            <span className="meta text-faint">Keywords (any, in title or summary)</span>
            <div className="mt-1 flex gap-1.5">
              <input
                value={kw}
                onChange={(e) => setKw(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addKeywords())}
                placeholder="e.g. tsunami, sanctions, Taiwan"
                className="block w-full rounded border border-line bg-bg-elev px-2 py-1"
              />
              <button onClick={addKeywords} className="shrink-0 rounded border border-line px-2 text-[12px] text-muted hover:text-fg">Add</button>
            </div>
            <Chips values={rule.keywords ?? []} label={(v) => v} onRemove={(v) => remove("keywords", v)} />
          </div>

          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={rule.minImportance !== undefined} onChange={(e) => set({ minImportance: e.target.checked ? 60 : undefined })} />
              <span>Minimum importance</span>
            </label>
            {rule.minImportance !== undefined && (
              <>
                <input type="range" min={0} max={100} step={5} value={rule.minImportance} onChange={(e) => set({ minImportance: Number(e.target.value) })} className="w-48" aria-label="Minimum importance" />
                <span className="tabular w-8 text-muted">{rule.minImportance}</span>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function AlertRules() {
  const [rules, setRules] = useState<Draft[] | null>(null);
  const [saved, setSaved] = useState<string>("[]");
  const [discord, setDiscord] = useState<boolean | null>(null);
  const [max, setMax] = useState(50);
  const [status, setStatus] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [sources, setSources] = useState<Array<{ id: string; name: string }>>([]);
  const [countries, setCountries] = useState<Array<{ code: string; name: string }>>([]);

  useEffect(() => {
    const ctrl = new AbortController();
    api
      .alertRules(ctrl.signal)
      .then((d) => {
        setRules(d.rules);
        setSaved(JSON.stringify(d.rules));
        setDiscord(d.discord);
        setMax(d.max);
      })
      .catch((e: Error) => e.name !== "AbortError" && setStatus({ kind: "err", text: e.message }));
    api.sources(ctrl.signal).then((d) => setSources(d.sources.filter((s) => s.id !== "demo").map((s) => ({ id: s.id, name: s.name })).sort((a, b) => a.name.localeCompare(b.name)))).catch(() => {});
    fetch("/api/countries", { signal: ctrl.signal }).then((r) => r.json()).then((d) => setCountries(d.countries ?? [])).catch(() => {});
    return () => ctrl.abort();
  }, []);

  const dirty = useMemo(() => rules !== null && JSON.stringify(rules) !== saved, [rules, saved]);

  const save = async () => {
    if (!rules) return;
    setSaving(true);
    setStatus(null);
    try {
      const d = await api.saveAlertRules(rules);
      setRules(d.rules);
      setSaved(JSON.stringify(d.rules));
      setStatus({ kind: "ok", text: "Saved" });
    } catch (e) {
      setStatus({ kind: "err", text: (e as Error).message });
    } finally {
      setSaving(false);
    }
  };

  if (!rules) return <p className="text-[12.5px] text-muted">{status?.text ?? "Loading…"}</p>;

  return (
    <div className="space-y-3">
      <p className="text-[12px] leading-relaxed text-faint">
        Get a Discord message (“[WorldView] 🔔 rule name”) when a new event matches a rule. Every filter you set must match; within a filter any value matches. Checked every 2 minutes by the
        server and every 15 minutes by the battery sentinel; each event is posted once per rule.
      </p>
      {discord === false && (
        <p className="rounded border border-warn/30 bg-warn/10 px-3 py-2 text-[12px] text-warn">
          Discord isn’t set up (DISCORD_WEBHOOK_URL in .env.local), so rules are saved but nothing is posted. “Test” still works.
        </p>
      )}
      {rules.length === 0 && <p className="py-4 text-center text-[12.5px] text-muted">No alert rules yet.</p>}
      {rules.map((r, i) => (
        <RuleEditor
          key={r.id}
          rule={r}
          sources={sources}
          countries={countries}
          onChange={(next) => setRules(rules.map((x, j) => (j === i ? next : x)))}
          onDelete={() => setRules(rules.filter((_, j) => j !== i))}
        />
      ))}
      <div className="flex items-center gap-2 pt-1">
        <button disabled={rules.length >= max} onClick={() => setRules([...rules, blank()])} className="rounded border border-line px-2.5 py-1 text-[12px] text-muted hover:text-fg disabled:opacity-40">
          + Add rule
        </button>
        <button disabled={!dirty || saving} onClick={save} className="rounded border border-accent/50 px-2.5 py-1 text-[12px] text-accent hover:bg-accent/10 disabled:opacity-40">
          {saving ? "Saving…" : "Save rules"}
        </button>
        {dirty && <span className="text-[11.5px] text-warn">Unsaved changes</span>}
        {status && <span className={clsx("text-[11.5px]", status.kind === "ok" ? "text-live" : "text-danger")}>{status.text}</span>}
      </div>
    </div>
  );
}
