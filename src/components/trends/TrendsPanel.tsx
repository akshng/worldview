"use client";
/**
 * Trends: what people are searching for, reading and sharing — an attention signal,
 * not a record of verified events. Google Trends, Wikipedia, Bluesky, Mastodon, Hacker News.
 */
import clsx from "clsx";
import { useEffect, useState, type ReactNode } from "react";
import { api } from "@/lib/client/api";
import type { GoogleTrend, Trends } from "@/lib/trends";
import { useUI } from "@/lib/store/ui";
import { relativeTime } from "@/lib/time";
import { CloseIcon } from "@/components/ui/icons";

const fmt = (n: number) => n.toLocaleString("en-US");
const compact = (n: number) => new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);
const exploreUrl = (term: string, geo?: string) =>
  `https://trends.google.com/trends/explore?date=now%201-d${geo ? `&geo=${geo}` : ""}&q=${encodeURIComponent(term)}`;

function Ext({ href, className, title, children }: { href: string; className?: string; title?: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className={clsx("hover:text-accent", className)} title={title}>
      {children}
    </a>
  );
}

function Section({ title, right, note, children }: { title: string; right?: ReactNode; note?: ReactNode; children: ReactNode }) {
  return (
    <section className="border-t border-line pt-3 first:border-t-0 first:pt-0">
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <h3 className="meta text-faint">{title}</h3>
        {right}
      </div>
      {children}
      {note && <p className="mt-1 text-[10.5px] text-faint">{note}</p>}
    </section>
  );
}

const Empty = ({ what }: { what: string }) => <p className="text-[12px] text-warn">{what} unavailable right now.</p>;

function Tabs<T extends string>({ items, value, onChange, label }: { items: Array<{ id: T; label: string }>; value: T; onChange: (v: T) => void; label: string }) {
  return (
    <div className="flex flex-wrap gap-1" role="tablist" aria-label={label}>
      {items.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={clsx("rounded px-1.5 py-0.5 text-[11px]", value === t.id ? "bg-panel-hover text-fg" : "text-muted hover:text-fg")}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

function SearchItem({ item, rank, geo }: { item: GoogleTrend; rank: number; geo: string }) {
  return (
    <li className="border-b border-line py-1.5">
      <div className="flex items-baseline gap-2 text-[12.5px]">
        <span className="tabular w-4 shrink-0 text-right text-[11px] text-faint">{rank}</span>
        <Ext href={exploreUrl(item.title, geo)} className="min-w-0 flex-1 truncate font-medium" title="Open in Google Trends">
          {item.title}
        </Ext>
        {item.traffic && <span className="tabular shrink-0 text-[11px] text-muted" title="Approximate searches (Google's bucket)">{item.traffic}</span>}
      </div>
      {item.news.slice(0, 2).map((n) => (
        <Ext key={n.url} href={n.url} className="mt-0.5 ml-6 block truncate text-[11.5px] text-muted" title={n.title}>
          {n.title}
          {n.source && <span className="text-faint"> · {n.source}</span>}
        </Ext>
      ))}
    </li>
  );
}

export function TrendsPanel() {
  const open = useUI((s) => s.trendsOpen);
  const setOpen = useUI((s) => s.setTrendsOpen);
  const [data, setData] = useState<Trends | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [geo, setGeo] = useState("US");
  const [lang, setLang] = useState("en");
  const [mastoTab, setMastoTab] = useState<"links" | "tags">("links");

  useEffect(() => {
    if (!open) return;
    const ctrl = new AbortController();
    api.trends(ctrl.signal).then(setData).catch((e) => e.name !== "AbortError" && setErr(e.message));
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => {
      ctrl.abort();
      window.removeEventListener("keydown", onKey);
    };
  }, [open, setOpen]);

  if (!open) return null;
  const country = data?.google.find((c) => c.geo === geo) ?? data?.google[0];
  const wiki = data?.wikipedia.find((w) => w.lang === lang) ?? data?.wikipedia[0];
  const nameOf = (g: string) => data?.google.find((c) => c.geo === g)?.name ?? g;

  return (
    <div className="fixed inset-0 z-50 flex justify-center overflow-y-auto bg-black/60 py-8" onMouseDown={() => setOpen(false)}>
      <div className="glass h-fit w-[940px] max-w-[calc(100vw-32px)] rounded-lg shadow-2xl shadow-black/60" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Trends">
        <div className="flex items-start justify-between border-b border-line px-6 pt-5 pb-4">
          <div>
            <div className="meta text-accent">Trends</div>
            <h2 className="mt-1 text-[20px] font-semibold">What the world is searching and sharing</h2>
            <p className="mt-1 text-[12px] text-muted">
              Search, reading and social trends from keyless public sources.{data && ` Updated ${relativeTime(data.generatedAt)}.`} Attention signals, not verified events.
            </p>
          </div>
          <button onClick={() => setOpen(false)} className="rounded p-1 text-muted hover:bg-panel-hover hover:text-fg" aria-label="Close trends panel">
            <CloseIcon />
          </button>
        </div>

        <div className="space-y-4 px-6 py-5">
          {err && <p className="text-[12px] text-danger">{err}</p>}
          {!data && !err && <p className="text-[12px] text-muted">Loading…</p>}
          {data && (
            <>
              {(data.failed.length > 0 || data.stale.length > 0) && (
                <div className="space-y-0.5 text-[11px]">
                  {data.failed.length > 0 && <p className="text-warn">Unavailable right now: {data.failed.join(", ")}</p>}
                  {data.stale.length > 0 && <p className="text-faint">Showing the last successful fetch for: {data.stale.join(", ")}</p>}
                </div>
              )}

              <Section
                title="Searches by country · Google Trends"
                note="Google's daily trending searches per country; traffic is Google's approximate bucket. Click a term for its Google Trends chart."
              >
                {data.google.length === 0 ? (
                  <Empty what="Google Trends" />
                ) : (
                  <div className="grid grid-cols-1 gap-x-6 gap-y-3 md:grid-cols-2">
                    <div>
                      <label className="mb-1 flex items-center gap-2 text-[11px] text-faint">
                        Country
                        <select
                          value={country?.geo}
                          onChange={(e) => setGeo(e.target.value)}
                          className="rounded border border-line bg-bg px-1.5 py-0.5 text-[12px] text-fg"
                        >
                          {[...data.google].sort((a, b) => a.name.localeCompare(b.name)).map((c) => (
                            <option key={c.geo} value={c.geo}>{c.name}</option>
                          ))}
                        </select>
                      </label>
                      {country && (
                        <ol>
                          {country.items.map((it, i) => <SearchItem key={it.title} item={it} rank={i + 1} geo={country.geo} />)}
                        </ol>
                      )}
                    </div>
                    <div>
                      <div className="mb-1 py-0.5 text-[11px] text-faint">Trending in several countries at once ({data.google.length} countries checked)</div>
                      {data.crossCountry.length === 0 ? (
                        <p className="text-[12px] text-muted">No search term is trending in more than one country right now.</p>
                      ) : (
                        <ol>
                          {data.crossCountry.slice(0, 12).map((c) => (
                            <li key={c.title} className="border-b border-line py-1.5">
                              <div className="flex items-baseline gap-2 text-[12.5px]">
                                <Ext href={exploreUrl(c.title)} className="min-w-0 flex-1 truncate font-medium">{c.title}</Ext>
                                <span className="tabular shrink-0 text-[11px] text-muted">{c.geos.length} countries</span>
                              </div>
                              <div className="mt-0.5 flex flex-wrap gap-1">
                                {c.geos.map((g) => (
                                  <button key={g} onClick={() => setGeo(g)} title={nameOf(g)} className={clsx("meta rounded-sm px-1 py-[1px] text-[10px]", g === country?.geo ? "bg-accent-soft text-accent" : "bg-white/5 text-muted hover:text-fg")}>
                                    {g}
                                  </button>
                                ))}
                              </div>
                            </li>
                          ))}
                        </ol>
                      )}
                    </div>
                  </div>
                )}
              </Section>

              <Section
                title="Most-read on Wikipedia"
                right={data.wikipedia.length > 0 && <Tabs label="Wikipedia language" items={data.wikipedia.map((w) => ({ id: w.lang, label: w.name }))} value={wiki?.lang ?? "en"} onChange={setLang} />}
                note={wiki && `Page views for ${wiki.date} (UTC), all devices, via the Wikimedia pageviews API. Main pages and non-article namespaces removed. Counts can include automated traffic that Wikimedia did not filter.`}
              >
                {!wiki ? (
                  <Empty what="Wikipedia pageviews" />
                ) : (
                  <ol className="grid grid-cols-1 gap-x-6 md:grid-cols-2" dir="auto">
                    {wiki.articles.slice(0, 20).map((a, i) => (
                      <li key={a.url} className="flex items-baseline gap-2 border-b border-line py-1 text-[12.5px]">
                        <span className="tabular w-4 shrink-0 text-right text-[11px] text-faint">{i + 1}</span>
                        <Ext href={a.url} className="min-w-0 flex-1 truncate">{a.title}</Ext>
                        <span className="tabular shrink-0 text-[11px] text-muted" title={`${fmt(a.views)} views`}>{compact(a.views)}</span>
                      </li>
                    ))}
                  </ol>
                )}
              </Section>

              <div className="grid grid-cols-1 gap-x-6 gap-y-4 border-t border-line pt-3 md:grid-cols-2">
                <Section title="Bluesky trending" note="Bluesky's public trending topics (post counts as reported by Bluesky).">
                  {data.bluesky.length === 0 ? (
                    <Empty what="Bluesky" />
                  ) : (
                    <ul>
                      {data.bluesky.slice(0, 12).map((t) => (
                        <li key={t.url + t.title} className="border-b border-line py-1.5">
                          <div className="flex items-baseline gap-2 text-[12.5px]">
                            <Ext href={t.url} className="min-w-0 flex-1 truncate font-medium" title={t.description ?? undefined}>{t.title}</Ext>
                            {t.status === "hot" && <span className="meta shrink-0 text-[10px] text-warn">hot</span>}
                            {t.postCount !== null && <span className="tabular shrink-0 text-[11px] text-muted">{compact(t.postCount)} posts</span>}
                          </div>
                          {(t.description || t.category) && (
                            <div className="mt-0.5 line-clamp-1 text-[11.5px] text-faint">
                              {t.category && <span className="text-muted">{t.category.replace(/-/g, " ")}</span>}
                              {t.category && t.description && " · "}
                              {t.description}
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </Section>

                <Section
                  title={`Mastodon · ${data.mastodon.instance}`}
                  right={<Tabs label="Mastodon trends" items={[{ id: "links", label: "Links" }, { id: "tags", label: "Hashtags" }]} value={mastoTab} onChange={setMastoTab} />}
                  note={`Trending on ${data.mastodon.instance} (one large server, not the whole fediverse). Counts cover the last two days.`}
                >
                  {data.mastodon.tags.length === 0 && data.mastodon.links.length === 0 ? (
                    <Empty what="Mastodon" />
                  ) : mastoTab === "links" ? (
                    <ul>
                      {data.mastodon.links.slice(0, 12).map((l) => (
                        <li key={l.url} className="border-b border-line py-1.5">
                          <Ext href={l.url} className="line-clamp-1 text-[12.5px]" title={l.description ?? l.title}>{l.title}</Ext>
                          <div className="text-[11px] text-faint">
                            {l.provider && <span className="text-muted">{l.provider} · </span>}
                            {fmt(l.uses)} shares by {fmt(l.accounts)} accounts
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <ul>
                      {data.mastodon.tags.slice(0, 15).map((t) => (
                        <li key={t.name} className="flex items-baseline gap-2 border-b border-line py-1 text-[12.5px]">
                          <Ext href={t.url} className="min-w-0 flex-1 truncate">#{t.name}</Ext>
                          <span className="tabular shrink-0 text-[11px] text-muted">{fmt(t.uses)} posts · {fmt(t.accounts)} accounts</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </Section>
              </div>

              <Section title="Hacker News front page · technology" note="Hacker News front page via the Algolia HN Search API, ordered by points.">
                {data.hackernews.length === 0 ? (
                  <Empty what="Hacker News" />
                ) : (
                  <ol className="grid grid-cols-1 gap-x-6 md:grid-cols-2">
                    {data.hackernews.slice(0, 16).map((h) => (
                      <li key={h.hnUrl} className="flex items-baseline gap-2 border-b border-line py-1 text-[12.5px]">
                        <Ext href={h.url} className="min-w-0 flex-1 truncate">{h.title}</Ext>
                        <Ext href={h.hnUrl} className="tabular shrink-0 text-[11px] text-muted" title="Discussion on Hacker News">
                          {h.points} pts · {h.comments}
                        </Ext>
                      </li>
                    ))}
                  </ol>
                )}
              </Section>

              <p className="border-t border-line pt-3 text-[10.5px] text-faint">
                Sources: Google Trends trending-searches RSS ({data.google.length} countries), Wikimedia pageviews API, Bluesky public AppView, Mastodon ({data.mastodon.instance}) trends API, Hacker News via
                Algolia. All keyless; cached for 15 minutes. X/Twitter is not included: it has no free or keyless public API, and this app does not use third-party scrapers. Reddit is
                not included: its JSON endpoints refuse unauthenticated requests and its robots.txt disallows automated access. Only aggregate trends and public titles are shown; no
                information about individual users is collected. Trends measure attention — what people are searching for or talking about — not verified events.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
