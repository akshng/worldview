"use client";
import clsx from "clsx";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useUI, type MapStyleId } from "@/lib/store/ui";
import { useData } from "@/lib/client/data-store";
import { api, type SourcesResponse } from "@/lib/client/api";
import { APP_NAME, APP_TAGLINE } from "@/lib/config/app";
import { TIME_RANGES, formatUtc, relativeTime } from "@/lib/time";
import { CloseIcon, ExternalIcon } from "@/components/ui/icons";
import { SafeLink } from "@/components/ui/primitives";

const TABS = [
  { id: "general", label: "General" },
  { id: "map", label: "Map" },
  { id: "sources", label: "Data sources" },
  { id: "about", label: "About" },
] as const;

export function SettingsModal() {
  const open = useUI((s) => s.settingsOpen);
  const tab = useUI((s) => s.settingsTab);
  const close = useUI((s) => s.closeSettings);
  const openSettings = useUI((s) => s.openSettings);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/55" onMouseDown={close}>
      <div className="glass flex h-[620px] w-[860px] overflow-hidden rounded-lg shadow-2xl shadow-black/60" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Settings">
        <nav className="w-44 shrink-0 border-r border-line p-3">
          <div className="meta px-2 pb-3 text-faint">Settings</div>
          {TABS.map((t) => (
            <button key={t.id} onClick={() => openSettings(t.id)} className={clsx("block w-full rounded px-2 py-1.5 text-left text-[13px]", tab === t.id ? "bg-panel-hover text-fg" : "text-muted hover:text-fg")}>
              {t.label}
            </button>
          ))}
        </nav>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-11 items-center justify-between border-b border-line px-5">
            <span className="text-[13px] font-medium">{TABS.find((t) => t.id === tab)?.label}</span>
            <button onClick={close} className="rounded p-1 text-muted hover:bg-panel-hover hover:text-fg" aria-label="Close settings"><CloseIcon width={14} height={14} /></button>
          </div>
          <div className="scroll-thin flex-1 overflow-y-auto px-5 py-4">
            {tab === "general" && <General />}
            {tab === "map" && <MapSettings />}
            {tab === "sources" && <Sources />}
            {tab === "about" && <About />}
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6 border-b border-line py-3 last:border-0">
      <div>
        <div className="text-[13px]">{label}</div>
        {hint && <div className="mt-0.5 text-[11.5px] text-faint">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} className={clsx("relative h-5 w-9 rounded-full transition-colors", on ? "bg-accent/70" : "bg-white/12")}>
      <span className={clsx("absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all", on ? "left-[18px]" : "left-0.5")} />
    </button>
  );
}

function Select<T extends string>({ value, options, onChange, label }: { value: T; options: Array<{ id: T; label: string; disabled?: boolean }>; onChange: (v: T) => void; label: string }) {
  return (
    <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value as T)} className="rounded border border-line bg-bg-elev px-2 py-1 text-[12.5px]">
      {options.map((o) => (
        <option key={o.id} value={o.id} disabled={o.disabled}>{o.label}</option>
      ))}
    </select>
  );
}

function formatGB(b: number) {
  return `${(b / 1e9).toFixed(2)} GB`;
}

/** On-device model status: keyless, runs locally, downloads once. */
function LocalAIRow() {
  const [status, setStatus] = useState<NonNullable<import("@/lib/client/api").MetaResponse["ai"]["local"]> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    const load = () => api.meta().then((m) => setStatus(m.ai.local)).catch(() => {});
    load();
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, []);
  const label =
    !status ? "…"
    : status.state === "ready" ? "Ready (loaded in memory)"
    : status.state === "downloaded" ? "Downloaded — loads on first use"
    : status.state === "loading" ? "Loading model…"
    : status.state === "downloading" ? `Downloading ${formatGB(status.downloadedBytes)} / ${formatGB(status.totalBytes)}`
    : status.state === "error" ? `Error: ${status.message}`
    : "Not downloaded (≈2.5 GB, one time)";
  return (
    <Row label="On-device AI model" hint="Qwen3-4B-Instruct (Apache-2.0) via llama.cpp — no account, no API key, nothing leaves this computer.">
      <div className="flex items-center gap-2">
        <span className="text-[12px] text-muted">{label}</span>
        {status?.state === "not-downloaded" || status?.state === "error" ? (
          <button
            onClick={() => api.setupLocalAI().catch((e) => setErr(e.message))}
            className="rounded border border-ai/40 px-2 py-0.5 text-[12px] text-ai hover:bg-ai/10"
          >
            Download
          </button>
        ) : null}
        {err && <span className="text-[11px] text-danger">{err}</span>}
      </div>
    </Row>
  );
}

function General() {
  const s = useUI((st) => st.settings);
  const update = useUI((st) => st.updateSettings);
  const meta = useData((st) => st.meta);
  return (
    <>
      <Row label="Theme" hint="Additional themes are planned.">
        <Select label="Theme" value="dark" options={[{ id: "dark", label: "Dark" }, { id: "light", label: "Light (coming later)", disabled: true }]} onChange={() => {}} />
      </Row>
      <Row label="Auto-refresh" hint="Receive live updates from the server as sources refresh.">
        <Toggle label="Auto-refresh" on={s.autoRefresh} onChange={(v) => update({ autoRefresh: v })} />
      </Row>
      <Row label="Default time range" hint="Applied when the app loads.">
        <Select label="Default time range" value={s.defaultRange} options={TIME_RANGES.map((r) => ({ id: r.id, label: r.label }))} onChange={(v) => update({ defaultRange: v })} />
      </Row>
      <Row label="Show AI interpretation" hint={meta?.ai.enabled ? `Provider: ${meta.ai.provider} · ${meta.ai.model}` : (meta?.ai.reason ?? "AI is optional.")}>
        <Toggle label="Show AI interpretation" on={s.showAI} onChange={(v) => update({ showAI: v })} />
      </Row>
      {meta?.ai.provider === "local" && <LocalAIRow />}
      <Row label="Developer mode" hint="Show ingestion runs, raw records and event ids.">
        <Toggle label="Developer mode" on={s.developerMode} onChange={(v) => update({ developerMode: v })} />
      </Row>
    </>
  );
}

function MapSettings() {
  const s = useUI((st) => st.settings);
  const update = useUI((st) => st.updateSettings);
  const categories = useUI((st) => st.categories);
  const [saved, setSaved] = useState(false);
  return (
    <>
      <Row label="Map style" hint="Satellite and night imagery: NASA GIBS (public domain).">
        <Select<MapStyleId>
          label="Map style"
          value={s.mapStyle}
          options={[
            { id: "dark", label: "Dark vector" },
            { id: "satellite", label: "Blue Marble" },
            { id: "night", label: "Night lights" },
          ]}
          onChange={(v) => update({ mapStyle: v })}
        />
      </Row>
      <Row label="Show event labels" hint="Event titles appear when zoomed in.">
        <Toggle label="Show event labels" on={s.showEventLabels} onChange={(v) => update({ showEventLabels: v })} />
      </Row>
      <Row label="Day / night shading" hint="Live solar terminator with twilight bands.">
        <Toggle label="Day / night shading" on={s.showDayNight} onChange={(v) => update({ showDayNight: v })} />
      </Row>
      <Row label="Default layers" hint={`${s.defaultCategories.length} layers enabled on load.`}>
        <button
          onClick={() => {
            update({ defaultCategories: categories });
            setSaved(true);
            setTimeout(() => setSaved(false), 1500);
          }}
          className="rounded border border-line px-2.5 py-1 text-[12px] text-muted hover:text-fg"
        >
          {saved ? "Saved" : "Use current layers"}
        </button>
      </Row>
    </>
  );
}

const STATUS_COLOR: Record<string, string> = {
  ONLINE: "var(--live)",
  RUNNING: "var(--accent)",
  DEGRADED: "var(--warn)",
  ERROR: "var(--danger)",
  PENDING: "var(--text-muted)",
  DISABLED: "var(--text-faint)",
};

function Sources() {
  const developer = useUI((s) => s.settings.developerMode);
  const [data, setData] = useState<SourcesResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [running, setRunning] = useState<string | null>(null);

  const load = useCallback(() => {
    api.sources().then(setData).catch((e) => setErr(e.message));
  }, []);
  useEffect(() => {
    load();
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, [load]);

  const runNow = async (id: string) => {
    setRunning(id);
    try {
      await api.ingest(id);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setRunning(null);
      load();
    }
  };

  if (err && !data) return <p className="text-[12.5px] text-danger">{err}</p>;
  if (!data) return <p className="text-[12.5px] text-muted">Loading…</p>;

  return (
    <div>
      <div className="mb-3 flex items-center gap-3 text-[12px] text-muted">
        <span className={clsx("meta rounded-sm px-1.5 py-[1px]", data.mode === "demo" ? "bg-warn/15 text-warn" : "bg-live/15 text-live")}>{data.mode} mode</span>
        <span>{data.eventCount.toLocaleString("en-US")} events stored</span>
        <span className="text-faint">· repository: {data.repository}</span>
      </div>
      <table className="w-full text-left text-[12.5px]">
        <thead>
          <tr className="meta text-faint">
            <th className="py-2 font-normal">Source</th>
            <th className="font-normal">Status</th>
            <th className="font-normal">Last success</th>
            <th className="font-normal">Last attempt</th>
            <th className="text-right font-normal">Received</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {data.sources.map((s) => (
            <tr key={s.id} className="border-t border-line align-top">
              <td className="py-2.5 pr-3">
                <div className="flex items-center gap-1.5 font-medium">
                  {s.name}
                  {s.homepage && (
                    <SafeLink href={s.homepage} className="text-faint hover:text-accent"><ExternalIcon width={11} height={11} /></SafeLink>
                  )}
                </div>
                <div className="mt-0.5 max-w-[260px] text-[11px] leading-snug text-faint">{s.description}</div>
                {(s.disabledReason || (s.lastRun && s.lastRun.errors.length > 0)) && (
                  <div className={clsx("mt-1 max-w-[300px] text-[11px] leading-snug", s.status === "ERROR" ? "text-danger" : "text-warn")}>
                    {s.disabledReason ?? s.lastRun?.errors[0]}
                  </div>
                )}
              </td>
              <td className="pr-3 pt-2.5">
                <span className="meta inline-flex items-center gap-1.5" style={{ color: STATUS_COLOR[s.status] }}>
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: STATUS_COLOR[s.status] }} />
                  {s.status}
                </span>
                <div className="meta mt-1 normal-case tracking-normal text-faint">every {Math.round(s.refreshIntervalMs / 60_000)} min</div>
              </td>
              <td className="pr-3 pt-2.5 text-muted">{s.lastSuccessAt ? relativeTime(s.lastSuccessAt) : "—"}</td>
              <td className="pr-3 pt-2.5 text-muted">{s.lastAttemptAt ? relativeTime(s.lastAttemptAt) : "—"}</td>
              <td className="tabular pt-2.5 text-right text-muted">{s.lastRun ? s.lastRun.recordsReceived.toLocaleString("en-US") : "—"}</td>
              <td className="pt-2 pl-3 text-right">
                <button
                  disabled={running === s.id || s.status === "DISABLED" || s.status === "RUNNING"}
                  onClick={() => runNow(s.id)}
                  className="rounded border border-line px-2 py-0.5 text-[11.5px] text-muted hover:text-fg disabled:opacity-40"
                  title="Fetch now (respects upstream rate limits — use sparingly)"
                >
                  {running === s.id ? "Running…" : "Run now"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <LiveLayersTable />

      {developer && (
        <div className="mt-6">
          <div className="meta mb-2 text-faint">Recent ingestion runs</div>
          <table className="w-full text-left text-[11.5px]">
            <thead>
              <tr className="meta text-faint">
                <th className="py-1.5 font-normal">Started</th>
                <th className="font-normal">Source</th>
                <th className="font-normal">Result</th>
                <th className="text-right font-normal">Recv</th>
                <th className="text-right font-normal">New</th>
                <th className="text-right font-normal">Upd</th>
                <th className="text-right font-normal">Dedup</th>
                <th className="text-right font-normal">ms</th>
              </tr>
            </thead>
            <tbody className="tabular">
              {data.runs.map((r) => (
                <tr key={r.id} className="border-t border-line" title={r.errors.join("\n")}>
                  <td className="py-1.5 text-muted">{formatUtc(r.startedAt, false)}</td>
                  <td>{r.dataSourceId}</td>
                  <td style={{ color: r.success ? "var(--live)" : "var(--danger)" }}>{r.success ? "ok" : (r.errors[0] ?? "failed").slice(0, 40)}</td>
                  <td className="text-right">{r.recordsReceived}</td>
                  <td className="text-right">{r.recordsCreated}</td>
                  <td className="text-right">{r.recordsUpdated}</td>
                  <td className="text-right">{r.recordsDeduplicated}</td>
                  <td className="text-right text-faint">{r.durationMs ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

interface LayerHealth {
  id: string;
  name: string;
  description: string;
  homepage: string;
  ttlMs: number;
  status: "OK" | "ERROR" | "DISABLED" | "IDLE";
  disabledReason: string | null;
  lastFetchedAt: string | null;
  count: number | null;
  error: string | null;
}

const LAYER_COLOR: Record<LayerHealth["status"], string> = {
  OK: "var(--live)",
  ERROR: "var(--danger)",
  DISABLED: "var(--text-faint)",
  IDLE: "var(--text-muted)",
};

function LiveLayersTable() {
  const [layers, setLayers] = useState<LayerHealth[] | null>(null);
  useEffect(() => {
    const load = () => fetch("/api/layers").then((r) => r.json()).then((b) => setLayers(b.layers)).catch(() => {});
    load();
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, []);
  if (!layers) return null;
  return (
    <div className="mt-6">
      <div className="meta mb-1 text-faint">Live layers</div>
      <p className="mb-2 text-[11.5px] text-faint">Observations shown in map modes (not stored as events). Fetched only while a mode is in use.</p>
      <table className="w-full text-left text-[12.5px]">
        <tbody>
          {layers.map((l) => (
            <tr key={l.id} className="border-t border-line align-top">
              <td className="py-2.5 pr-3">
                <div className="flex items-center gap-1.5 font-medium">
                  {l.name}
                  <SafeLink href={l.homepage} className="text-faint hover:text-accent"><ExternalIcon width={11} height={11} /></SafeLink>
                </div>
                <div className="mt-0.5 max-w-[340px] text-[11px] leading-snug text-faint">{l.description}</div>
                {(l.disabledReason || l.error) && <div className="mt-1 text-[11px] text-warn">{l.disabledReason ?? l.error}</div>}
              </td>
              <td className="pt-2.5 pr-3">
                <span className="meta inline-flex items-center gap-1.5" style={{ color: LAYER_COLOR[l.status] }}>
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: LAYER_COLOR[l.status] }} />
                  {l.status === "IDLE" ? "Not in use" : l.status}
                </span>
                <div className="meta mt-1 normal-case tracking-normal text-faint">cache {Math.round(l.ttlMs / 60_000)} min</div>
              </td>
              <td className="pt-2.5 text-muted">{l.lastFetchedAt ? relativeTime(l.lastFetchedAt) : "—"}</td>
              <td className="tabular pt-2.5 text-right text-muted">{l.count?.toLocaleString("en-US") ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function About() {
  const mode = useData((s) => s.mode);
  return (
    <div className="max-w-xl space-y-3 text-[13px] leading-relaxed text-muted">
      <p><span className="text-fg">{APP_NAME}</span> — {APP_TAGLINE}</p>
      <p>
        Every event on the map is derived from a listed, linkable public source. Verified facts and AI interpretation are stored in separate fields and
        displayed separately. Importance is a transparent rule-based score; status is never “Confirmed” without an authoritative final record.
      </p>
      {mode === "demo" && <p className="text-warn">Demo mode is active: all events are simulated and are not real.</p>}
      <p className="text-faint">
        Basemap © OpenFreeMap / OpenMapTiles / OpenStreetMap contributors. Imagery: NASA GIBS. Reference geography: Natural Earth (public domain).
      </p>
    </div>
  );
}
