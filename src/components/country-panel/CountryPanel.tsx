"use client";
import clsx from "clsx";
import { useEffect, useState } from "react";
import { api, type CountryResponse } from "@/lib/client/api";
import { useUI } from "@/lib/store/ui";
import { useData } from "@/lib/client/data-store";
import { CATEGORIES } from "@/lib/categories";
import { relativeTime } from "@/lib/time";
import { CloseIcon } from "@/components/ui/icons";
import { ImportanceMeter, SectionTitle } from "@/components/ui/primitives";
import { focusEvent } from "@/components/event-feed/EventFeed";
import { CountryProfile } from "./CountryProfile";
import type { EventCategory } from "@/types/events";
import type { GoogleTrend } from "@/lib/trends";

/** The country's top Google trending searches, when Trends covers it (≈40 countries). */
function CountrySearches({ code, name }: { code: string; name: string }) {
  const [res, setRes] = useState<{ code: string; items: GoogleTrend[] | null; error?: string } | null>(null);
  useEffect(() => {
    if (!/^[A-Z]{2}$/.test(code)) return;
    const ctrl = new AbortController();
    api
      .countryTrends(code, ctrl.signal)
      .then((r) => setRes({ code, items: r.country?.items ?? null }))
      .catch((e) => e.name !== "AbortError" && setRes({ code, items: null, error: e.message }));
    return () => ctrl.abort();
  }, [code]);
  const cur = res?.code === code ? res : null;
  if (!cur || (!cur.items && !cur.error)) return null;
  return (
    <section className="border-t border-line px-4 py-3.5">
      <SectionTitle
        right={
          <button onClick={() => useUI.getState().setTrendsOpen(true)} className="meta text-faint hover:text-accent">
            All trends
          </button>
        }
      >
        Trending searches in {name}
      </SectionTitle>
      {cur.error ? (
        <p className="text-[12px] text-warn">Google Trends unavailable right now.</p>
      ) : (
        <ol className="space-y-1">
          {cur.items!.slice(0, 6).map((t) => (
            <li key={t.title} className="flex items-baseline gap-2 text-[12.5px]">
              <a
                href={t.news[0]?.url ?? `https://trends.google.com/trends/explore?date=now%201-d&geo=${code}&q=${encodeURIComponent(t.title)}`}
                target="_blank"
                rel="noreferrer"
                className="min-w-0 flex-1 truncate hover:text-accent"
                title={t.news[0]?.title ?? t.title}
              >
                {t.title}
              </a>
              {t.traffic && <span className="tabular shrink-0 text-[11px] text-faint">{t.traffic}</span>}
            </li>
          ))}
        </ol>
      )}
      <p className="mt-1.5 text-[10.5px] text-faint">Google Trends daily trending searches: what people are looking up, not verified events.</p>
    </section>
  );
}

export function CountryPanel() {
  const code = useUI((s) => s.selectedCountry);
  const version = useData((s) => s.version);
  const [data, setData] = useState<CountryResponse | null>(null);
  const [failure, setFailure] = useState<{ code: string; message: string } | null>(null);
  const [tab, setTab] = useState<"top" | "recent">("top");

  useEffect(() => {
    if (!code) return;
    const ctrl = new AbortController();
    api
      .country(code, ctrl.signal)
      .then((d) => {
        setData(d);
        setFailure(null);
      })
      .catch((e) => e.name !== "AbortError" && setFailure({ code, message: e.message }));
    return () => ctrl.abort();
  }, [code, version]);
  const error = failure?.code === code ? failure.message : null;

  // Fly to the country once its data arrives.
  useEffect(() => {
    if (!data || data.country.code !== code) return;
    const c = data.country;
    if (c.label) useUI.getState().requestFlyTo({ lon: c.label[0], lat: c.label[1], zoom: 4, bbox: c.bbox ?? undefined });
  }, [data?.country.code]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!code) return null;
  const d = data?.country.code === code ? data : null;
  const cats = d ? Object.entries(d.byCategory24h).sort((a, b) => b[1] - a[1]) : [];
  const maxCat = Math.max(1, ...cats.map(([, n]) => n));
  const list = d ? (tab === "top" ? d.topEvents : d.recentEvents) : [];

  return (
    <div className="glass panel-in pointer-events-auto flex max-h-full w-[400px] max-w-[calc(100vw-24px)] flex-col self-start rounded-md shadow-2xl shadow-black/50">
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <span className="meta text-faint">Country overview</span>
        <button onClick={() => useUI.getState().selectCountry(null)} className="rounded-md p-1.5 text-muted hover:bg-panel-hover hover:text-fg" aria-label="Close country overview" title="Close (Esc)">
          <CloseIcon width={14} height={14} />
        </button>
      </div>
      <div className="scroll-thin overflow-y-auto">
        {error && <div className="p-6 text-[12.5px] text-danger">{error}</div>}
        {!d && !error && <div className="p-6 text-[12.5px] text-muted">Loading…</div>}
        {d && (
          <>
            <div className="px-4 pt-3.5 pb-3">
              <h2 className="text-[19px] font-semibold tracking-[0.06em] uppercase">{d.country.name}</h2>
              <div className="meta mt-1 text-faint">
                {[d.country.subregion, d.country.population ? `Pop. ${(d.country.population / 1e6).toFixed(1)}M (Natural Earth)` : null].filter(Boolean).join(" · ")}
              </div>
            </div>
            <div className="grid grid-cols-3 border-y border-line">
              {[
                { label: "Events stored", value: d.totalEvents },
                { label: "Last 24h", value: d.last24h },
                { label: "High importance", value: d.highImportance },
              ].map((s, i) => (
                <div key={s.label} className={clsx("px-4 py-2.5", i && "border-l border-line")}>
                  <div className="meta text-faint">{s.label}</div>
                  <div className="tabular mt-0.5 text-[18px] font-medium">{s.value}</div>
                </div>
              ))}
            </div>

            <CountryProfile code={d.country.code} />

            <section className="px-4 py-3.5">
              <SectionTitle>Last 24 hours by category</SectionTitle>
              {cats.length === 0 ? (
                <p className="text-[12.5px] text-muted">No events recorded in the last 24 hours.</p>
              ) : (
                <ul className="space-y-1.5">
                  {cats.map(([type, n]) => {
                    const c = CATEGORIES[type as EventCategory];
                    return (
                      <li key={type} className="flex items-center gap-2 text-[12px]">
                        <span className="w-24 shrink-0 text-muted">{c?.label ?? type}</span>
                        <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/5">
                          <span className="block h-full rounded-full" style={{ width: `${(n / maxCat) * 100}%`, background: c?.color }} />
                        </span>
                        <span className="tabular w-8 text-right">{n}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <CountrySearches code={d.country.code} name={d.country.name} />

            <section className="border-t border-line px-4 py-3.5">
              <SectionTitle
                right={
                  <span className="flex gap-1">
                    {(["top", "recent"] as const).map((t) => (
                      <button key={t} onClick={() => setTab(t)} className={clsx("meta rounded px-1.5 py-0.5", tab === t ? "bg-panel-hover text-fg" : "text-faint hover:text-muted")}>
                        {t === "top" ? "Major" : "Latest"}
                      </button>
                    ))}
                  </span>
                }
              >
                Events in {d.country.name}
              </SectionTitle>
              {list.length === 0 && <p className="text-[12.5px] text-muted">No events stored for this country.</p>}
              <ul className="-mx-2">
                {list.map((e) => (
                  <li key={e.id}>
                    <button onClick={() => focusEvent(e)} className="w-full rounded px-2 py-2 text-left hover:bg-panel-hover">
                      <div className="flex items-center justify-between gap-2">
                        <span className="meta" style={{ color: CATEGORIES[e.type].color }}>{CATEGORIES[e.type].label}</span>
                        <ImportanceMeter score={e.importanceScore} />
                      </div>
                      <div className="mt-0.5 line-clamp-2 text-[12.5px] leading-snug">{e.title}</div>
                      <div className="meta mt-0.5 normal-case tracking-[0.02em] text-faint">{relativeTime(e.timestamp)} · {e.sourceCount} source{e.sourceCount === 1 ? "" : "s"}</div>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
