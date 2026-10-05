"use client";
import clsx from "clsx";
import { useEffect, useState } from "react";
import { api, type EventDetailResponse } from "@/lib/client/api";
import { useUI } from "@/lib/store/ui";
import { useData } from "@/lib/client/data-store";
import { useNow } from "@/lib/client/use-now";
import { formatUtc, relativeTime } from "@/lib/time";
import { CATEGORIES } from "@/lib/categories";
import { CategoryLabel, ImportanceMeter, SafeLink, SectionTitle, SimulatedBadge, StatusBadge } from "@/components/ui/primitives";
import { CloseIcon, ExternalIcon, SparkIcon } from "@/components/ui/icons";
import { focusEvent } from "@/components/event-feed/EventFeed";
import { ExposureChip } from "@/components/markets/MarketsPanel";
import type { EventMetrics, WorldEvent } from "@/types/events";

const METRIC_LABELS: Record<string, string> = {
  magnitude: "Magnitude",
  magnitude_type: "Magnitude type",
  depth_km: "Depth (km)",
  tsunami: "Tsunami flag",
  alert_level: "Alert level",
  felt_reports: "Felt reports",
  usgs_significance: "USGS significance",
  detections: "Satellite detections",
  frp_total_mw: "Radiative power (MW)",
  frp_max_mw: "Peak FRP (MW)",
  confidence_high: "High-confidence detections",
  satellite: "Satellite",
  severity: "Severity",
  urgency: "Urgency",
  certainty: "Certainty",
  event_name: "Alert type",
  wind_kts: "Wind (kt)",
  population_affected: "Population affected (est.)",
  goldstein: "Goldstein scale",
  num_articles: "Articles (GDELT)",
  num_sources: "Sources (GDELT)",
  num_mentions: "Mentions (GDELT)",
  avg_tone: "Average tone",
  cameo_code: "CAMEO code",
  launch_status: "Launch status",
  provider: "Provider",
  rocket: "Vehicle",
  mission: "Mission",
  crewed: "Crewed",
  pad: "Launch pad",
  started_at: "Started",
  area_km2: "Area (km²)",
};

const PRECISION_TEXT: Record<WorldEvent["geoPrecision"], string> = {
  exact: "Exact coordinates reported by the source.",
  city: "Located at city level — the marker is the city, not the exact spot (ring ≈ 8 km).",
  region: "Located at region/area level (ring ≈ 40 km, or the drawn area).",
  approximate: "Approximate location from the source (ring ≈ 120 km).",
  country: "Only the country is known — the marker is the country's centre (ring ≈ 350 km).",
};

function formatMetric(k: string, v: EventMetrics[string]): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "number") return v.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (k.endsWith("_at") && !Number.isNaN(Date.parse(v))) return formatUtc(v);
  return v;
}

export function EventPanel() {
  const id = useUI((s) => s.selectedEventId);
  const close = () => useUI.getState().selectEvent(null);
  const showAI = useUI((s) => s.settings.showAI);
  const developer = useUI((s) => s.settings.developerMode);
  const revision = useData((s) => (id ? (s.eventRevision[id] ?? 0) : 0));
  const version = useData((s) => s.version);
  const [data, setData] = useState<EventDetailResponse | null>(null);
  const [failure, setFailure] = useState<{ id: string; message: string } | null>(null);

  useEffect(() => {
    if (!id) return;
    const ctrl = new AbortController();
    api
      .event(id, ctrl.signal)
      .then((d) => {
        setData(d);
        setFailure(null);
      })
      .catch((e) => e.name !== "AbortError" && setFailure({ id, message: e.message }));
    return () => ctrl.abort();
  }, [id, revision, version]);
  const error = failure?.id === id ? failure.message : null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !useUI.getState().searchOpen && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!id) return null;
  const ev = data?.event.id === id ? data.event : null;

  return (
    <div className="glass panel-in pointer-events-auto flex max-h-full self-start w-[420px] flex-col rounded-md shadow-2xl shadow-black/50">
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <span className="meta text-faint">Event</span>
        <button onClick={close} className="rounded p-1 text-muted hover:bg-panel-hover hover:text-fg" aria-label="Close event details">
          <CloseIcon width={14} height={14} />
        </button>
      </div>
      <div className="scroll-thin overflow-y-auto">
        {!ev && !error && <div className="p-6 text-[12.5px] text-muted">Loading…</div>}
        {error && <div className="p-6 text-[12.5px] text-danger">{error}</div>}
        {ev && <EventBody ev={ev} related={data!.related} exposure={data!.marketExposure ?? []} showAI={showAI} developer={developer} />}
      </div>
    </div>
  );
}

function EventBody({ ev, related, exposure, showAI, developer }: { ev: WorldEvent; related: EventDetailResponse["related"]; exposure: EventDetailResponse["marketExposure"]; showAI: boolean; developer: boolean }) {
  const metrics = Object.entries(ev.metrics).filter(([, v]) => v !== null && v !== "" && v !== undefined);
  return (
    <>
      {/* Header */}
      <div className="px-4 pt-3.5 pb-4">
        <div className="flex flex-wrap items-center gap-2">
          <CategoryLabel type={ev.type} />
          {ev.subtype && <span className="meta text-faint">{ev.subtype.replace(/[-_]/g, " ")}</span>}
          <span className="flex-1" />
          <StatusBadge status={ev.status} />
          {ev.isSynthetic && <SimulatedBadge />}
        </div>
        <h2 className="mt-2 text-[17px] leading-snug font-semibold">{ev.title}</h2>
        <div className="mt-1.5 text-[12.5px] text-muted">
          {ev.locationName ?? ev.countryName ?? "Unknown location"}
        </div>
        <div className="meta mt-1 normal-case tracking-[0.02em] text-faint">
          {relativeTime(ev.timestamp)} · {formatUtc(ev.timestamp)}
        </div>
        <div className="mt-3 flex items-center gap-4">
          <ImportanceMeter score={ev.importanceScore} showLabel />
          <span className="meta text-faint">Confidence {(ev.confidenceScore * 100).toFixed(0)}%</span>
          <span className="meta text-faint">{ev.sourceCount} source{ev.sourceCount === 1 ? "" : "s"}</span>
        </div>
      </div>

      {/* FACTS */}
      <section className="border-t border-line px-4 py-3.5">
        <SectionTitle right={<span className="meta text-live/80">Verified from sources</span>}>Overview</SectionTitle>
        <p className="text-[13px] leading-relaxed text-fg/90">{ev.summary}</p>
        {ev.description && ev.description !== ev.summary && (
          <p className="mt-2 text-[12.5px] leading-relaxed text-muted">{ev.description}</p>
        )}
        {metrics.length > 0 && (
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2">
            {metrics.slice(0, 12).map(([k, v]) => (
              <div key={k}>
                <dt className="meta text-faint">{METRIC_LABELS[k] ?? k.replace(/_/g, " ")}</dt>
                <dd className="tabular mt-0.5 text-[12.5px]">{formatMetric(k, v)}</dd>
              </div>
            ))}
          </dl>
        )}
      </section>

      {/* LOCATION */}
      <section className="border-t border-line px-4 py-3.5">
        <SectionTitle>Location</SectionTitle>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[12.5px]">
          <div><dt className="meta text-faint">Coordinates</dt><dd className="tabular mt-0.5">{ev.latitude.toFixed(3)}, {ev.longitude.toFixed(3)}</dd></div>
          <div><dt className="meta text-faint">Precision</dt><dd className="mt-0.5 capitalize">{ev.geoPrecision}</dd></div>
          <div>
            <dt className="meta text-faint">Country</dt>
            <dd className="mt-0.5">
              {ev.country ? (
                <button className="text-accent hover:underline" onClick={() => useUI.getState().selectCountry(ev.country)}>
                  {ev.countryName ?? ev.country}
                </button>
              ) : (
                <span className="text-muted">Not determined</span>
              )}
            </dd>
          </div>
          <div><dt className="meta text-faint">Region</dt><dd className="mt-0.5">{ev.region ?? "—"}</dd></div>
          {ev.city && <div><dt className="meta text-faint">City</dt><dd className="mt-0.5">{ev.city}</dd></div>}
          {ev.geometry && <div><dt className="meta text-faint">Area</dt><dd className="mt-0.5">Drawn on the map ({ev.geometry.type === "MultiPolygon" ? `${ev.geometry.coordinates.length} parts` : "polygon"})</dd></div>}
        </dl>
        <p className="mt-2 text-[11.5px] leading-snug text-faint">{PRECISION_TEXT[ev.geoPrecision]}</p>
        {ev.geoNote && (
          <p className={clsx("mt-2 rounded border px-2 py-1.5 text-[11.5px] leading-snug", ev.geoNote.method === "unverified-geocode" ? "border-warn/30 text-warn" : "border-line text-muted")}>
            {ev.geoNote.detail}
          </p>
        )}
      </section>

      {/* TIMELINE */}
      <section className="border-t border-line px-4 py-3.5">
        <SectionTitle>Timeline</SectionTitle>
        <ol className="relative ml-1 border-l border-line">
          {ev.timeline.map((t, i) => (
            <li key={i} className="relative pb-2.5 pl-4 last:pb-0">
              <span
                className={clsx(
                  "absolute top-1.5 -left-[4px] h-[7px] w-[7px] rounded-full border",
                  t.kind === "OFFICIAL_CONFIRMATION" ? "border-live bg-live/40" : t.kind === "RESOLVED" ? "border-faint bg-faint/40" : "border-accent bg-accent/30",
                )}
              />
              <div className="meta normal-case tracking-[0.02em] text-faint">{formatUtc(t.at)} · {t.kind.replace(/_/g, " ").toLowerCase()}</div>
              <div className="text-[12.5px] text-fg/90">{t.label}</div>
            </li>
          ))}
        </ol>
      </section>

      {/* SOURCES */}
      <section className="border-t border-line px-4 py-3.5">
        <SectionTitle>Sources ({ev.sources.length})</SectionTitle>
        <ul className="space-y-2">
          {ev.sources.map((s) => (
            <li key={s.id} className="rounded border border-line px-2.5 py-2">
              <div className="flex items-start justify-between gap-2">
                <SafeLink href={s.sourceUrl} className="group flex min-w-0 items-center gap-1.5 text-[12.5px] font-medium text-fg hover:text-accent">
                  <span className="truncate">{s.sourceName}</span>
                  {s.sourceUrl && <ExternalIcon width={12} height={12} className="shrink-0 opacity-60 group-hover:opacity-100" />}
                </SafeLink>
                <span className="meta shrink-0 text-faint">{s.sourceType.replace(/_/g, " ").toLowerCase()}</span>
              </div>
              {s.title && (
                <div className="mt-1 text-[12px] leading-snug text-muted">
                  {s.title}
                  {s.titleIsDerived && <span className="meta ml-1.5 text-faint normal-case">(title derived from URL)</span>}
                </div>
              )}
              <div className="meta mt-1 normal-case tracking-[0.02em] text-faint">
                {s.publishedAt ? `Published ${formatUtc(s.publishedAt)}` : "Publish time unknown"} · retrieved {relativeTime(s.retrievedAt)}
              </div>
              {s.credibility && <div className="meta mt-0.5 normal-case tracking-[0.02em] text-faint">{s.credibility.basis}</div>}
            </li>
          ))}
        </ul>
      </section>

      {/* IMPORTANCE */}
      <section className="border-t border-line px-4 py-3.5">
        <SectionTitle>Why this score</SectionTitle>
        <ul className="space-y-1">
          {ev.importanceFactors.map((f) => (
            <li key={f.factor} className="flex items-baseline gap-2 text-[12px]">
              <span className="w-24 shrink-0 capitalize text-muted">{f.factor}</span>
              <span className="tabular w-10 shrink-0 text-right">+{f.points}</span>
              <span className="truncate text-faint" title={f.detail}>{f.detail}</span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[11px] text-faint">Rule-based score (0–100). See docs/EVENT_MODEL.md.</p>
      </section>

      {/* RELATED */}
      {related.length > 0 && (
        <section className="border-t border-line px-4 py-3.5">
          <SectionTitle>Related events</SectionTitle>
          <ul className="space-y-1">
            {related.map((r) => (
              <li key={r.event.id}>
                <button onClick={() => focusEvent(r.event)} className="w-full rounded px-2 py-1.5 text-left hover:bg-panel-hover">
                  <div className="flex items-center gap-2">
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: CATEGORIES[r.event.type].color }} />
                    <span className="line-clamp-1 text-[12.5px]">{r.event.title}</span>
                  </div>
                  <div className="meta mt-0.5 pl-3.5 normal-case tracking-[0.02em] text-faint">
                    {r.relation === "NEARBY" ? "Nearby" : r.relation.replace(/_/g, " ").toLowerCase()} · {r.basis}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {exposure.length > 0 && <MarketExposure links={exposure} since={ev.timestamp} />}

      {/* AI — visually separated, never mixed with facts */}
      {showAI && <AIInterpretation ev={ev} />}

      {developer && (
        <section className="border-t border-line px-4 py-3.5">
          <SectionTitle>Developer</SectionTitle>
          <div className="meta normal-case tracking-normal text-faint">id {ev.id}</div>
          <a className="meta text-accent normal-case tracking-normal hover:underline" href={`/api/events/${ev.id}?raw=1`} target="_blank" rel="noopener noreferrer">
            View raw JSON (incl. upstream records)
          </a>
        </section>
      )}
    </>
  );
}

function MarketExposure({ links, since }: { links: EventDetailResponse["marketExposure"]; since: string }) {
  const [quotes, setQuotes] = useState<Map<string, import("@/lib/client/api").Quote>>(new Map());
  const [moves, setMoves] = useState<Map<string, number | null>>(new Map());
  const key = links.map((l) => l.symbol).join(",");
  const now = useNow(60_000);
  const recent = now - Date.parse(since) < 5 * 86_400_000 && Date.parse(since) <= now;
  useEffect(() => {
    const ctrl = new AbortController();
    api.quotes(key.split(","), ctrl.signal).then((r) => setQuotes(new Map(r.quotes.map((q) => [q.symbol, q])))).catch(() => {});
    if (recent) api.reaction(key.split(","), since, ctrl.signal).then((r) => setMoves(new Map(r.results.map((x) => [x.symbol, x.changePct])))).catch(() => {});
    return () => ctrl.abort();
  }, [key, since, recent]);
  return (
    <section className="border-t border-line px-4 py-3.5">
      <SectionTitle right={<span className="meta text-faint">Rule-based · not advice</span>}>Market exposure</SectionTitle>
      <p className="mb-2 text-[10.5px] text-faint">Moves since the event are measurements; markets move for many reasons at once.</p>
      <ul className="space-y-1.5">
        {links.map((l) => (
          <li key={l.symbol} className="flex items-start justify-between gap-3 text-[12px]">
            <div className="min-w-0">
              <div className="text-fg/90">{l.name}</div>
              <div className="text-[11px] text-faint">{l.rationale}</div>
              {typeof moves.get(l.symbol) === "number" && (
                <div className="text-[11px] text-muted">
                  Since this event:{" "}
                  <span className="tabular" style={{ color: moves.get(l.symbol)! >= 0 ? "#3f8de8" : "#e5534b" }}>
                    {moves.get(l.symbol)! >= 0 ? "▲ +" : "▼ "}{moves.get(l.symbol)!.toFixed(2)}%
                  </span>
                </div>
              )}
            </div>
            <ExposureChip link={{ ...l, name: l.symbol }} quote={quotes.get(l.symbol)} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function AIInterpretation({ ev }: { ev: WorldEvent }) {
  const meta = useData((s) => s.meta);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ai = ev.aiInterpretation;

  const generate = async () => {
    setBusy(true);
    setErr(null);
    try {
      await api.interpret(ev.id);
      useData.setState((s) => ({ eventRevision: { ...s.eventRevision, [ev.id]: (s.eventRevision[ev.id] ?? 0) + 1 } }));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="m-3 rounded-md border border-ai/25 bg-ai-soft px-3.5 py-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="meta flex items-center gap-1.5 text-ai">
          <SparkIcon width={12} height={12} /> AI interpretation
        </h3>
        <span className="meta text-ai/60">Not verified fact</span>
      </div>
      {ai ? (
        <>
          <p className="text-[12.5px] leading-relaxed text-fg/85 italic">{ai.text}</p>
          <div className="meta mt-2 flex items-center justify-between normal-case tracking-[0.02em] text-faint">
            <span>{ai.provider} · {ai.model} · {relativeTime(ai.generatedAt)}</span>
            <button onClick={generate} disabled={busy} className="text-ai/80 hover:text-ai disabled:opacity-50">{busy ? "Regenerating…" : "Regenerate"}</button>
          </div>
        </>
      ) : ev.isSynthetic ? (
        <p className="text-[12px] text-muted">Disabled for simulated events.</p>
      ) : meta?.ai.enabled ? (
        <button onClick={generate} disabled={busy} className="rounded border border-ai/30 px-2.5 py-1 text-[12px] text-ai hover:bg-ai/10 disabled:opacity-50">
          {busy ? (meta.ai.provider === "local" ? "Thinking on this Mac… (first run loads the model)" : "Generating…") : "Generate interpretation"}
        </button>
      ) : (
        <p className="text-[12px] leading-relaxed text-muted">
          AI is turned off. Set <code className="text-fg/80">AI_PROVIDER=local</code> (default, keyless) in <code className="text-fg/80">.env.local</code> to enable it.
        </p>
      )}
      {err && <p className="mt-2 text-[12px] text-danger">{err}</p>}
      <p className="mt-2 text-[10.5px] leading-snug text-faint">
        Generated by a language model from the structured record above. It may be wrong and must not be treated as reporting.
      </p>
    </section>
  );
}
