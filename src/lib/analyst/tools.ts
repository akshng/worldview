/**
 * The analyst's tools: the app's own data as typed functions. Each tool calls
 * server modules directly (through `ToolDeps`, so tests can mock them) and
 * returns compact JSON plus citation metadata. Output is size-capped by the
 * agent (see cap.ts) before the model sees it.
 */
import { z } from "zod";
import type { WorldEvent, EventCategory } from "@/types/events";
import { EVENT_CATEGORIES } from "@/types/events";
import type { EventRepository } from "@/lib/db/types";
import type { Quote, MarketSnapshot, ExposureLink } from "@/lib/finance/types";
import type { HistoryRange, PriceHistory, YieldCurve } from "@/lib/finance/providers";
import type { ScreenerList, ScreenerResult } from "@/lib/finance/screeners";
import type { MacroDashboard } from "@/lib/finance/macro";
import type { CalendarItem } from "@/lib/finance/calendar";
import type { CotReport } from "@/lib/finance/cot";
import type { PredictionMarkets } from "@/lib/finance/prediction-markets";
import type { CryptoMarkets } from "@/lib/finance/crypto";
import type { AuctionResult } from "@/lib/finance/auctions";
import type { TermStructure } from "@/lib/finance/term-structure";
import type { CompanyProfile } from "@/lib/finance/company";
import type { FilingJobStatus } from "@/lib/finance/filing-format";
import type { ManagerHoldings, FundHolder, TrackedManager } from "@/lib/finance/thirteenf";
import type { EarningsFeed } from "@/lib/finance/earnings";
import type { Registration } from "@/lib/finance/ipos";
import type { SearchHit } from "@/lib/finance/search";
import type { Trends } from "@/lib/trends";
import type { EnergyDashboard } from "@/lib/energy";
import type { PlanetDashboard } from "@/lib/planet";
import type { ChokepointMonitor } from "@/lib/infra/chokepoints";
import type { SecurityDashboard } from "@/lib/cyber";
import type { CountryProfile } from "@/lib/country-profile";
import type { CitationAction } from "./types";
import { downsample } from "./cap";

// ─── Stock-ideas helpers ─────────────────────────────────────────────────────

type HorizonStat = { avg_excess_vs_sp500_pts: number | null; beat_sp500_pct: number | null; n: number } | null;

export function trackRecordSentence(from: string | null, week: HorizonStat, month: HorizonStat): string {
  const part = (h: HorizonStat, label: string) => {
    if (!h || h.avg_excess_vs_sp500_pts === null) return null;
    const x = h.avg_excess_vs_sp500_pts;
    return `${x >= 0 ? "beat" : "trailed"} the S&P 500 by ${Math.abs(x).toFixed(1)} points on average over ${label} (ahead of it ${h.beat_sp500_pct}% of the time)`;
  };
  const parts = [part(week, "1 week"), part(month, "1 month")].filter(Boolean);
  if (!parts.length) return "No track record available yet.";
  return `In a backtest since ${from ?? "?"}, stocks this screen flagged ${parts.join(", and ")}. That is not a reliable edge.`;
}

/** Ideas in the same industry that all fell hard today are really one bet. */
export function sameDayDrops(setups: Array<{ symbol: string; industry?: string | null; metrics: { change1d: number | null } }>): string | null {
  const groups = new Map<string, string[]>();
  for (const s of setups) {
    if ((s.metrics.change1d ?? 0) > -5) continue;
    const k = s.industry ?? "unknown industry";
    groups.set(k, [...(groups.get(k) ?? []), s.symbol]);
  }
  const notes = [...groups.entries()]
    .filter(([k, syms]) => syms.length >= 2 && k !== "unknown industry")
    .map(([k, syms]) => `${syms.join(", ")} are all in ${k.toLowerCase()} and fell 5%+ together, which points to one shared cause (industry news or a commodity move). Treat them as one bet, not ${syms.length}.`);
  return notes.length ? notes.join(" ") : null;
}

/** The standard way each kind of signal goes wrong. */
export function ideaRisks(signals: string[]): string[] {
  const out: string[] = [];
  if (signals.some((x) => x.startsWith("Sharp"))) out.push("Sudden drops usually follow bad news (earnings miss, guidance cut, downgrade) and can keep going.");
  if (signals.some((x) => x.startsWith("Pullback"))) out.push("The uptrend may be ending rather than pausing.");
  if (signals.some((x) => x.startsWith("Oversold"))) out.push("Oversold stocks can stay oversold for weeks.");
  return out;
}

/** A researched idea as finished text: small local models copy this reliably. */
export function ideaWriteUp(r: import("@/lib/finance/stock-research").StockResearch): string {
  const biz = r.fundamentals.length ? r.fundamentals.slice(0, 2).map((f) => `${f.metric} ${f.latest}${f.vsYearAgo ? ` (${f.vsYearAgo})` : ""}`).join("; ") : "No recent reported figures.";
  const ins = r.insiders ? `${r.insiders.buyers} insider${r.insiders.buyers === 1 ? "" : "s"} buying, ${r.insiders.sellers} selling in 90 days${r.insiders.notable[0] ? ` (latest: ${r.insiders.notable[0]})` : ""}` : "Insider data unavailable";
  return [
    `Why it moved: ${r.take.likelyCause}`,
    `Business: ${biz}`,
    `Insiders/funds: ${ins}${r.trackedFundsHolding ? `; held by ${r.trackedFundsHolding} of the big funds WorldView tracks` : ""}.`,
    ...(r.upcomingEarnings ? [`Coming up: ${r.upcomingEarnings}`] : []),
    `Take: ${r.take.take}. ${r.take.reason}`,
  ].join("\n");
}

/** The research packet, minus what the idea already says. */
export function researchForModel(r: import("@/lib/finance/stock-research").StockResearch) {
  return {
    headlines: r.headlines.map((h) => `${h.published ?? ""} ${h.source}: ${h.title}`.trim()),
    recent_filings: r.recentFilings.map((f) => `${f.filed} ${f.form}: ${f.what}`),
    earnings: r.earnings,
    fundamentals: r.fundamentals.map((f) => `${f.metric} ${f.latest}${f.vsYearAgo ? ` (${f.vsYearAgo})` : ""}, ${f.period}`),
    insiders: r.insiders ? `${r.insiders.buyers} buying, ${r.insiders.sellers} selling in 90 days. ${r.insiders.notable.join("; ")}` : null,
    tracked_funds_holding: r.trackedFundsHolding,
    upcoming_earnings: r.upcomingEarnings,
    likely_cause: r.take.likelyCause,
    suggested_take: r.take.take,
    take_reason: r.take.reason,
  };
}

export function ideaCheck(signals: string[]): string {
  if (signals.some((x) => x.startsWith("Sharp"))) return "Find out why it dropped (news, earnings, analyst calls) before anything else.";
  if (signals.some((x) => x.startsWith("Insider"))) return "Read the insider filings: who bought, how much, and at what price.";
  return "Check the latest earnings and guidance, and how it is valued against peers.";
}

// ─── Dependencies (real implementations in deps.ts) ─────────────────────────

export interface ToolDeps {
  repo: () => Promise<EventRepository>;
  now: () => number;
  getQuote: (symbol: string) => Promise<Quote>;
  getHistory: (symbol: string, range: HistoryRange) => Promise<PriceHistory>;
  changeSince: (symbol: string, sinceMs: number) => Promise<{ symbol: string; from: number | null; to: number | null; changePct: number | null }>;
  getMarketSnapshot: () => Promise<MarketSnapshot>;
  getScreener: (list: ScreenerList) => Promise<ScreenerResult>;
  searchInstruments: (q: string) => Promise<SearchHit[]>;
  getMacroDashboard: () => Promise<MacroDashboard>;
  getEconomicCalendar: () => Promise<CalendarItem[]>;
  getCot: () => Promise<CotReport>;
  getPredictionMarkets: () => Promise<PredictionMarkets>;
  getCryptoMarkets: () => Promise<CryptoMarkets>;
  getRecentAuctions: () => Promise<AuctionResult[]>;
  getYieldCurve: () => Promise<YieldCurve>;
  getTermStructure: () => Promise<TermStructure>;
  companyProfile: (ticker: string) => Promise<CompanyProfile | null>;
  filingAnalysisStatus: (accession: string) => Promise<FilingJobStatus>;
  startFilingAnalysis: (ticker: string, accession: string) => Promise<FilingJobStatus>;
  trackedManagers: TrackedManager[];
  managerHoldings: (cik: string, limit: number) => Promise<ManagerHoldings | null>;
  holdersOf: (ticker: string) => Promise<{ ticker: string; holders: FundHolder[]; checked: number; total: number; pending: number; caveats: string[] }>;
  /** Rule-based stock setups (price + insider buying), strongest first. */
  scanSetups: (opts: { max: number; minScore: number }) => Promise<{ setups: import("@/lib/finance/setups").Setup[]; scanned: number }>;
  /** Why a stock moved and how the business is doing (headlines, filings, earnings, fundamentals, insiders, funds). */
  researchStock: (ticker: string, nameHint?: string) => Promise<import("@/lib/finance/stock-research").StockResearch>;
  insiders: (ticker: string) => Promise<import("@/lib/finance/insiders").InsiderSummary | null>;
  dividends: (symbol: string) => Promise<import("@/lib/finance/dividends").Dividends>;
  shortVolume: (symbol: string) => Promise<import("@/lib/finance/short-volume").ShortVolume>;
  earningsOn: (date: string) => Promise<import("@/lib/finance/earnings-calendar").UpcomingEarnings[]>;
  headlines: (topic: string, days: number) => Promise<import("@/lib/finance/stock-news").Headline[]>;
  resolvePlace: (name: string) => import("./world-data").Place | null;
  infraNear: (lat: number, lon: number, radiusKm: number, kinds: import("./world-data").InfraKind[]) => Promise<unknown>;
  tracking: (kind: import("./world-data").TrackKind, place: import("./world-data").Place | null) => Promise<unknown>;
  sourceHealth: () => Promise<Array<{ id: string; name: string; status: string; categories: string[]; lastSuccessAt: string | null; description: string }>>;
  /** Backtest of the same rules: excess return vs the S&P 500 by horizon. */
  setupsTrackRecord: () => Promise<{ from: string | null; to: string | null; signals: import("@/lib/finance/setups-score").ScoreSummary; baseline: import("@/lib/finance/setups-score").ScoreSummary }>;
  getEarningsReleases: () => Promise<EarningsFeed>;
  getRegistrations: () => Promise<Registration[]>;
  getTrends: () => Promise<Trends>;
  getEnergy: () => Promise<EnergyDashboard>;
  getPlanetDashboard: () => Promise<PlanetDashboard>;
  getChokepointMonitor: (days: number) => Promise<ChokepointMonitor>;
  getSecurityDashboard: () => Promise<SecurityDashboard>;
  getCountryProfile: (code: string) => Promise<CountryProfile>;
  marketExposure: (e: WorldEvent) => ExposureLink[];
  marketMovers: (events: WorldEvent[], limit?: number) => Array<{ event: WorldEvent; exposure: ExposureLink[] }>;
  findCountry: (nameOrCode: string) => { code: string; name: string } | null;
}

// ─── Tool definitions ────────────────────────────────────────────────────────

export type ParamType = "string" | "number" | "integer" | "boolean" | "string[]";

export interface ParamSpec {
  type: ParamType;
  description: string;
  enum?: readonly string[];
  required?: boolean;
}

export interface ToolResult {
  data: unknown;
  /** One line for the step indicator ("3 quotes", "8 events") */
  summary: string;
  source: string;
  asOf?: string | null;
  links?: Array<{ label: string; url: string }>;
  actions?: CitationAction[];
}

export interface ToolDef {
  name: string;
  description: string;
  params: Record<string, ParamSpec>;
  run: (args: Record<string, unknown>, deps: ToolDeps) => Promise<ToolResult>;
}

export const MAX_SYMBOLS = 10;
const RANGES = ["1d", "5d", "1mo", "6mo", "1y", "5y"] as const;
const SCREENER_LISTS = ["gainers", "losers", "active"] as const;
const PM_TOPICS = ["economics", "financials", "politics", "world"] as const;

// ─── Helpers ─────────────────────────────────────────────────────────────────

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const clamp = (v: number | undefined, lo: number, hi: number, dflt: number) => Math.min(hi, Math.max(lo, v ?? dflt));
const cut = (s: string | null | undefined, n: number) => (s ? (s.length > n ? `${s.slice(0, n - 1)}…` : s) : null);
/** Latest of several timestamps; date-only values ("2026-09-29") stay date-only. */
const latest = (dates: Array<string | null | undefined>): string | null => {
  let best: string | null = null;
  let bestT = -Infinity;
  for (const d of dates) {
    const t = d ? Date.parse(d) : NaN;
    if (Number.isFinite(t) && t > bestT) {
      bestT = t;
      best = /^\d{4}-\d{2}-\d{2}$/.test(d!) ? d! : new Date(t).toISOString();
    }
  }
  return best;
};
const has = (hay: string | null | undefined, needle: string) => !!hay && hay.toLowerCase().includes(needle.toLowerCase());

export function compactEvent(e: WorldEvent) {
  return {
    id: e.id,
    type: e.type,
    title: cut(e.title, 160),
    summary: cut(e.summary, 220),
    where: e.locationName ?? e.countryName ?? null,
    country: e.country,
    time: e.timestamp,
    status: e.status,
    importance: e.importanceScore,
    sources: e.sourceCount,
    ...(e.isSynthetic ? { simulated: true } : {}),
  };
}

const eventAction = (e: Pick<WorldEvent, "id" | "latitude" | "longitude" | "title">): CitationAction => ({ kind: "event", id: e.id, lat: e.latitude, lon: e.longitude, label: cut(e.title, 60) ?? e.id });
const instrumentAction = (symbol: string, label?: string): CitationAction => ({ kind: "instrument", symbol, label: label ?? symbol });

function compactQuote(q: Quote) {
  return {
    symbol: q.symbol,
    name: q.name,
    price: q.price,
    change: q.change,
    changePct: q.changePct,
    move: q.unit === "percent" ? (q.change === null ? null : `${q.change >= 0 ? "+" : ""}${q.change} pp vs previous close`) : q.changePct === null ? null : `${q.changePct >= 0 ? "+" : ""}${q.changePct.toFixed(2)}% vs previous close`,
    unit: q.unit === "percent" ? "% yield" : (q.currency ?? undefined),
    asOf: q.asOf,
    delayed: q.delayed || undefined,
    error: q.error,
  };
}

const sourcesOf = (xs: Array<{ source: string }>, fallback: string) => [...new Set(xs.map((x) => x.source).filter((s) => s && s !== "unavailable"))].join("; ") || fallback;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The repository matches substrings anywhere (incl. publisher names: "nvda" hits
 * "nvdaily.com"). Re-check terms as words in the event's own text: short terms
 * as whole words, longer ones as word prefixes ("tanker" → "tankers").
 */
export function wordMatches(e: WorldEvent, query: string): boolean {
  const hay = [e.title, e.summary, e.locationName, e.countryName, e.subtype, ...(e.entities ?? []).map((x) => x.name), String(e.metrics?.ticker ?? "")].filter(Boolean).join(" ").toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((t) => new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(t)}${t.length <= 5 ? "($|[^\\p{L}\\p{N}])" : ""}`, "u").test(hay));
}

async function searchEventsLoose(repo: EventRepository, q: Parameters<EventRepository["query"]>[0], query: string | undefined) {
  const wide = { ...q, limit: Math.max(60, (q.limit ?? 8) * 6) };
  const limit = q.limit ?? 8;
  if (!query) return (await repo.query(q)).events;
  const hits = (await repo.query({ ...wide, q: query.toLowerCase() })).events.filter((e) => wordMatches(e, query));
  if (hits.length || !query.includes(" ")) return hits.slice(0, limit);
  // All-terms match failed: fall back to any meaningful term.
  const terms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 2 && !STOP.has(t));
  const seen = new Map<string, WorldEvent>();
  for (const t of terms.slice(0, 4)) for (const e of (await repo.query({ ...wide, q: t })).events) if (wordMatches(e, t)) seen.set(e.id, e);
  return [...seen.values()].sort((a, b) => b.importanceScore - a.importanceScore).slice(0, limit);
}

/** "NVIDIA CORP" → "nvidia" (as the instrument view does). */
const shortCompanyName = (name: string) => name.replace(/,?\s+(inc|corp|corporation|co|ltd|plc|holdings|group|company)\.?$/i, "").replace(/[,.]/g, "").trim();
const STOP = new Set(["the", "and", "for", "with", "what", "whats", "about", "today", "news", "events", "latest", "from", "into", "that", "this", "are", "any"]);

// ─── The tools ───────────────────────────────────────────────────────────────

export const TOOLS: ToolDef[] = [
  // Events
  {
    name: "search_events",
    description: "Search world events tracked by the app (news, conflict, disasters, filings...). Returns the most important matches.",
    params: {
      query: { type: "string", description: "Keywords, e.g. 'oil tanker', 'Taiwan', 'Nvidia'" },
      category: { type: "string", description: "Event category", enum: EVENT_CATEGORIES },
      country: { type: "string", description: "Country name or ISO-2 code" },
      hours: { type: "integer", description: "Look back this many hours (default 24, max 168)" },
      limit: { type: "integer", description: "Max events (default 8, max 15)" },
      source: { type: "string", description: "Only one data source by id, e.g. central-banks, ofac-sanctions, sanctions-news, cloud-status, app-status, fda-recalls, cpsc-recalls, hibp-breaches, un-press, nasdaq-halts, sec-insider-buys, sec-enforcement, treasury-auctions, ecdc, iaea, volcanic-ash, defense-releases, doj-press, market-regulators, eu-commission, trade-policy, us-economic-releases, eia-energy, fda-medwatch, nasa-news, ifrc-appeals, swpc-alerts, faa-tfr, river-flooding, spc-watches, geofon, cyber-advisories, uk-defence, fema-declarations, sec-13d, usgs, gdacs, news-rss (see data_sources)" },
    },
    async run(a, d) {
      const hours = clamp(num(a.hours), 1, 168, 24);
      const sourceId = str(a.source);
      if (sourceId) {
        const repo = await d.repo();
        const all = await repo.scan({ from: new Date(d.now() - hours * 3_600_000).toISOString() });
        const q = str(a.query)?.toLowerCase();
        const events = all
          .filter((e) => e.sources.some((s) => s.dataSourceId === sourceId) && (!q || `${e.title} ${e.summary}`.toLowerCase().includes(q)))
          .sort((x, y) => Date.parse(y.timestamp) - Date.parse(x.timestamp))
          .slice(0, clamp(num(a.limit), 1, 15, 8));
        return {
          data: { source: sourceId, window: `last ${hours} h`, count: events.length, events: events.map(compactEvent) },
          summary: `${events.length} from ${sourceId}`,
          source: `WorldView event store (${sourceId})`,
          asOf: latest(events.map((e) => e.updatedAt)),
          actions: events.slice(0, 5).map(eventAction),
        };
      }
      const country = str(a.country) ? d.findCountry(str(a.country)!)?.code : undefined;
      const repo = await d.repo();
      const limit = clamp(num(a.limit), 1, 15, 8);
      const base = { from: new Date(d.now() - hours * 3_600_000).toISOString(), type: str(a.category) ? [str(a.category) as EventCategory] : undefined, country, sort: "importance" as const, limit };
      const query = str(a.query);
      let events = await searchEventsLoose(repo, base, query);
      let matchedAs: string | undefined;
      // A ticker: also the filer's own SEC filings and news naming the company.
      if (query && /^[A-Z]{1,5}(-[A-Z])?$/.test(query)) {
        const [filings, profile] = await Promise.all([repo.scan({ from: base.from, type: ["BUSINESS"] }), d.companyProfile(query).catch(() => null)]);
        const name = profile ? shortCompanyName(profile.name) : null;
        const byName = name && name.length >= 3 ? await searchEventsLoose(repo, base, name.toLowerCase()) : [];
        matchedAs = name ? `${query} or "${name}"` : query;
        events = [...new Map([...filings.filter((e) => String(e.metrics?.ticker ?? "").toUpperCase() === query), ...events, ...byName].map((e) => [e.id, e])).values()]
          .sort((x, y) => y.importanceScore - x.importanceScore)
          .slice(0, limit);
      }
      return {
        data: { window: `last ${hours} h`, matched: matchedAs, count: events.length, events: events.map(compactEvent) },
        summary: `${events.length} event${events.length === 1 ? "" : "s"}`,
        source: "WorldView event store (aggregated public feeds)",
        asOf: latest(events.map((e) => e.updatedAt)),
        actions: events.slice(0, 5).map(eventAction),
        links: events.flatMap((e) => (e.sources[0]?.sourceUrl ? [{ label: e.sources[0].sourceName, url: e.sources[0].sourceUrl }] : [])).slice(0, 5),
      };
    },
  },
  {
    name: "get_event",
    description: "Full details of one event by id: sources, status, related market exposure.",
    params: { id: { type: "string", description: "Event id from search_events", required: true } },
    async run(a, d) {
      const repo = await d.repo();
      const e = await repo.get(String(a.id));
      if (!e) return { data: { found: false }, summary: "not found", source: "WorldView event store" };
      return {
        data: {
          ...compactEvent(e),
          description: cut(e.description, 600),
          confidence: e.confidenceScore,
          sources: e.sources.slice(0, 6).map((s) => ({ name: s.sourceName, url: s.sourceUrl })),
          marketExposure: e.isSynthetic ? [] : d.marketExposure(e),
        },
        summary: cut(e.title, 60) ?? e.id,
        source: `WorldView event store; ${[...new Set(e.sources.map((s) => s.sourceName))].slice(0, 3).join(", ")}`,
        asOf: e.updatedAt,
        actions: [eventAction(e)],
        links: e.sources.flatMap((s) => (s.sourceUrl ? [{ label: s.sourceName, url: s.sourceUrl }] : [])).slice(0, 5),
      };
    },
  },
  {
    name: "events_near",
    description: "Events within a radius of a point (lat/lon), e.g. around a port, strait or city.",
    params: {
      lat: { type: "number", description: "Latitude", required: true },
      lon: { type: "number", description: "Longitude", required: true },
      radius_km: { type: "number", description: "Radius in km (default 300, max 2000)" },
      hours: { type: "integer", description: "Look back hours (default 48, max 168)" },
    },
    async run(a, d) {
      const lat = clamp(num(a.lat), -90, 90, 0);
      const lon = clamp(num(a.lon), -180, 180, 0);
      const radiusKm = clamp(num(a.radius_km), 1, 2000, 300);
      const hours = clamp(num(a.hours), 1, 168, 48);
      const repo = await d.repo();
      const events = (await repo.findNear({ lat, lon, radiusKm, fromMs: d.now() - hours * 3_600_000, toMs: d.now() + 3_600_000 }))
        .sort((x, y) => y.importanceScore - x.importanceScore)
        .slice(0, 10);
      return {
        data: { center: [lat, lon], radiusKm, window: `last ${hours} h`, count: events.length, events: events.map(compactEvent) },
        summary: `${events.length} events within ${radiusKm} km`,
        source: "WorldView event store",
        asOf: latest(events.map((e) => e.updatedAt)),
        actions: events.slice(0, 5).map(eventAction),
      };
    },
  },
  {
    name: "exposure",
    description: "Rule-based market exposure. With event_id: the instruments that event could plausibly affect and their move since the event. Without: today's world events that have market exposure (optionally only those exposed to given symbols).",
    params: {
      event_id: { type: "string", description: "Event id (optional)" },
      symbols: { type: "string[]", description: "Only events exposed to these symbols, e.g. a watchlist (optional)" },
    },
    async run(a, d) {
      const repo = await d.repo();
      const id = str(a.event_id);
      if (id) {
        const e = await repo.get(id);
        if (!e) return { data: { found: false }, summary: "event not found", source: "WorldView exposure rules" };
        const links = e.isSynthetic ? [] : d.marketExposure(e);
        const moves = await Promise.all(links.slice(0, 4).map((l) => d.changeSince(l.symbol, Date.parse(e.timestamp)).catch(() => null)));
        return {
          data: {
            event: compactEvent(e),
            exposure: links.map((l, i) => ({ ...l, changeSinceEventPct: moves[i]?.changePct ?? null })),
            note: "Rule-based (docs/FINANCE.md). Co-movement is not evidence of cause.",
          },
          summary: `${links.length} linked instruments`,
          source: "WorldView exposure rules; Yahoo Finance (delayed)",
          asOf: e.updatedAt,
          actions: [eventAction(e), ...links.slice(0, 4).map((l) => instrumentAction(l.symbol, l.name))],
        };
      }
      const events = await repo.scan({ from: new Date(d.now() - 86_400_000).toISOString(), synthetic: "exclude" });
      const symbols = new Set(((a.symbols as string[] | undefined) ?? []).map((s) => s.toUpperCase()));
      const all = d.marketMovers(events, symbols.size ? 60 : 10);
      const row = (m: (typeof all)[number]) => ({ ...compactEvent(m.event), exposure: m.exposure.map((l) => `${l.symbol} (${l.name}): ${l.rationale}`) });
      const matching = symbols.size ? all.filter((m) => m.exposure.some((l) => symbols.has(l.symbol))).slice(0, 10) : all;
      const movers = symbols.size && !matching.length ? all.slice(0, 3) : matching;
      return {
        data: {
          window: "last 24 h",
          ...(symbols.size
            ? matching.length
              ? { exposedTo: [...symbols], events: matching.map(row) }
              : { exposedTo: [...symbols], events: [], note: "No event in the last 24 h has rule-based exposure to these symbols. Largest other events with exposure (to OTHER instruments):", otherEvents: movers.map(row) }
            : { events: movers.map(row) }),
          caveat: "Rule-based exposure (docs/FINANCE.md), not a forecast or trading signal.",
        },
        summary: symbols.size ? `${matching.length} events exposed to ${symbols.size} symbols` : `${movers.length} events with exposure`,
        source: "WorldView exposure rules",
        asOf: latest(movers.map((m) => m.event.updatedAt)),
        actions: movers.slice(0, 5).map((m) => eventAction(m.event)),
      };
    },
  },

  // Quotes and history
  {
    name: "get_quote",
    description: `Latest quotes (delayed) for up to ${MAX_SYMBOLS} Yahoo-style symbols: stocks (NVDA), indices (^GSPC), futures (CL=F oil, BZ=F Brent, GC=F gold, NG=F gas), FX (EURUSD=X), crypto (BTC-USD), rates (DGS10).`,
    params: { symbols: { type: "string[]", description: "Symbols", required: true } },
    async run(a, d) {
      const symbols = [...new Set((a.symbols as string[]).map((s) => s.toUpperCase()))].slice(0, MAX_SYMBOLS);
      const quotes = await Promise.all(symbols.map((s) => d.getQuote(s)));
      const ok = quotes.filter((q) => q.price !== null);
      return {
        data: { quotes: quotes.map(compactQuote), note: "Quotes are delayed; change is vs the previous close." },
        summary: `${ok.length}/${quotes.length} quotes`,
        source: sourcesOf(quotes, "Yahoo Finance (unofficial, delayed)"),
        asOf: latest(quotes.map((q) => q.asOf)),
        actions: quotes.filter((q) => q.price !== null).map((q) => instrumentAction(q.symbol, q.name)),
      };
    },
  },
  {
    name: "price_history",
    description: "Price history for one symbol with change over the range, high/low and 52-week range.",
    params: {
      symbol: { type: "string", description: "Symbol", required: true },
      range: { type: "string", description: "Range (default 1mo)", enum: RANGES },
    },
    async run(a, d) {
      const symbol = String(a.symbol).toUpperCase();
      const range = (str(a.range) ?? "1mo") as HistoryRange;
      const h = await d.getHistory(symbol, range);
      const closes = h.points.map((p) => p[1]);
      const first = h.points[0];
      const last = h.points.at(-1);
      return {
        data: {
          symbol,
          name: h.name,
          currency: h.currency,
          range,
          start: first ? { date: new Date(first[0]).toISOString().slice(0, 10), close: first[1] } : null,
          end: last ? { date: new Date(last[0]).toISOString(), close: last[1] } : null,
          changeOverRangePct: first && last && first[1] ? ((last[1] - first[1]) / first[1]) * 100 : null,
          high: closes.length ? Math.max(...closes) : null,
          low: closes.length ? Math.min(...closes) : null,
          fiftyTwoWeekHigh: h.fiftyTwoWeekHigh,
          fiftyTwoWeekLow: h.fiftyTwoWeekLow,
          closes: downsample(h.points, 16).map(([t, c]) => [new Date(t).toISOString().slice(0, range === "1d" || range === "5d" ? 16 : 10), c]),
        },
        summary: `${h.points.length} points, ${range}`,
        source: "Yahoo Finance chart (unofficial, delayed)",
        asOf: h.marketTime ?? (last ? new Date(last[0]).toISOString() : null),
        actions: [instrumentAction(symbol, h.name)],
      };
    },
  },
  {
    name: "market_snapshot",
    description: "Cross-asset snapshot: equity indices, sectors, rates, FX, bonds, volatility, commodities, crypto. Optionally one group only.",
    params: { group: { type: "string", description: "Only this group", enum: ["indices", "sectors", "rates", "fx", "bonds", "volatility", "commodities", "crypto"] } },
    async run(a, d) {
      const snap = await d.getMarketSnapshot();
      const group = str(a.group) as keyof MarketSnapshot["groups"] | undefined;
      const row = (q: Quote) => [q.symbol, q.name, q.price, q.unit === "percent" ? `${q.change ?? "n/a"} pp` : q.changePct === null ? null : `${q.changePct.toFixed(2)}%`];
      const KEY = new Set(["^GSPC", "^IXIC", "^VIX", "DGS2", "DGS10", "DX-Y.NYB", "EURUSD=X", "USDJPY=X", "CL=F", "BZ=F", "NG=F", "GC=F", "HG=F", "BTC-USD"]);
      const groups = Object.fromEntries(
        (Object.entries(snap.groups) as Array<[string, Quote[]]>)
          .filter(([g]) => !group || g === group)
          .map(([g, qs]) => {
            if (group) return [g, qs.map(row)];
            const key = qs.filter((q) => KEY.has(q.symbol));
            const movers = qs.filter((q) => !KEY.has(q.symbol) && q.changePct !== null).sort((x, y) => Math.abs(y.changePct!) - Math.abs(x.changePct!)).slice(0, 3);
            return [g, [...key, ...movers].map(row)];
          }),
      );
      const all = Object.values(snap.groups).flat();
      return {
        data: { columns: ["symbol", "name", "price", "change"], groups, note: group ? undefined : "Per group: benchmarks plus the 3 biggest movers." },
        summary: group ? `${group}` : "all asset classes",
        source: "Yahoo Finance (delayed), U.S. Treasury, Coinbase",
        asOf: latest(all.map((q) => q.asOf)) ?? snap.generatedAt,
      };
    },
  },
  {
    name: "stock_ideas",
    description:
      "Ranked US stock ideas from the app's screen: pullbacks in uptrends, oversold large caps, sharp drops, plus insider buying (SEC Form 4). Each comes with the reasons it was flagged, its risks and key numbers, and the screen's backtested track record vs the S&P 500. Use for 'what should I buy', stock picks, opportunities.",
    params: {},
    async run(_a, d) {
      const [scan, tr] = await Promise.all([d.scanSetups({ max: 5, minScore: 2 }), d.setupsTrackRecord().catch(() => null)]);
      // Industry from SEC (cached) so related picks can be grouped honestly, and the
      // homework done for the top 3: why it moved, earnings, fundamentals, insiders.
      const [industries, research] = await Promise.all([
        Promise.all(scan.setups.map((s) => d.companyProfile(s.symbol).then((p) => p?.industry ?? null).catch(() => null))),
        Promise.all(scan.setups.slice(0, 3).map((s) => d.researchStock(s.symbol, s.name).catch(() => null))),
      ]);
      const r1 = (v: number | null) => (v === null ? null : Math.round(v * 10) / 10);
      const horizon = (s: import("@/lib/finance/setups-score").ScoreSummary, days: number) => {
        const h = s.horizons.find((x) => x.days === days);
        return h ? { avg_excess_vs_sp500_pts: r1(h.avgExcess), beat_sp500_pct: h.beatRate === null ? null : Math.round(h.beatRate * 100), n: h.n } : null;
      };
      return {
        data: {
          scanned: scan.scanned,
          ideas: scan.setups.map((s, i) => ({
            rank: i + 1,
            symbol: s.symbol,
            name: s.name,
            industry: industries[i],
            price: r1(s.metrics.price),
            pct_from_52w_high: r1(s.metrics.fromHigh),
            why_flagged: s.signals,
            risks: [...s.risks, ...ideaRisks(s.signals)],
            ...(research[i] ? { suggested_take: research[i]!.take.take, write_up: ideaWriteUp(research[i]!) } : {}),
          })),
          // Plain sentences the writer can quote as-is (small models misread the numbers otherwise).
          track_record_sentence: tr ? trackRecordSentence(tr.from, horizon(tr.signals, 5), horizon(tr.signals, 21)) : "No track record available yet.",
          concentration_note: sameDayDrops(scan.setups.map((s, i) => ({ ...s, industry: industries[i] }))),
        },
        summary: `${scan.setups.length} ideas from ${scan.scanned} stocks`,
        source: "WorldView setups screen (Yahoo Finance prices, SEC Form 4)",
        asOf: new Date(d.now()).toISOString(),
        actions: scan.setups.slice(0, 5).map((s) => instrumentAction(s.symbol, s.name)),
      };
    },
  },
  {
    name: "research_stock",
    description: "Do the research on one stock: recent headlines explaining moves, SEC filings in the last 2 weeks, whether it just reported earnings, revenue/profit vs a year earlier, insider trades and fund ownership.",
    params: { ticker: { type: "string", description: "US ticker, e.g. VLO", required: true } },
    async run(a, d) {
      const t = (str(a.ticker) ?? "").toUpperCase();
      if (!/^[A-Z]{1,5}(-[A-Z])?$/.test(t)) throw new Error("A US stock ticker is required");
      const r = await d.researchStock(t);
      return {
        data: { ticker: t, company: r.company, industry: r.industry, write_up: ideaWriteUp(r), ...researchForModel(r) },
        summary: `${r.headlines.length} headlines, ${r.recentFilings.length} filings`,
        source: "Google News, SEC EDGAR (filings, XBRL, Form 4, 13F), Nasdaq earnings calendar",
        asOf: new Date(d.now()).toISOString(),
        actions: [instrumentAction(t, r.company ?? t)],
      };
    },
  },
  {
    name: "insider_trades",
    description: "Open-market insider buys and sells for a US stock in the last 90 days (SEC Form 4): who, role, date, value.",
    params: { ticker: { type: "string", description: "US ticker", required: true } },
    async run(a, d) {
      const t = (str(a.ticker) ?? "").toUpperCase();
      const s = await d.insiders(t);
      if (!s) throw new Error(`No SEC filer for ${t}`);
      return {
        data: { ticker: t, buyers: s.buyers, buyValueUsd: s.buyValue, sellers: s.sellers, sellValueUsd: s.sellValue, severalInsidersBuying: s.clusterBuy, trades: s.trades.slice(0, 10).map((x) => ({ date: x.date, who: x.owner, role: x.role, action: x.code === "P" ? "buy" : "sell", shares: x.shares, price: x.price, valueUsd: x.value })) },
        summary: `${s.buyers} buying, ${s.sellers} selling`,
        source: "SEC EDGAR Form 4",
        asOf: s.asOf,
        actions: [instrumentAction(t, t)],
      };
    },
  },
  {
    name: "dividends",
    description: "Dividend history for a stock or ETF: recent payments, trailing-12-month total, yield, payments per year.",
    params: { symbol: { type: "string", description: "Ticker", required: true } },
    async run(a, d) {
      const s = (str(a.symbol) ?? "").toUpperCase();
      const v = await d.dividends(s);
      return { data: { ...v, payments: v.payments.slice(-8) }, summary: v.yieldPct !== null ? `yield ${v.yieldPct.toFixed(2)}%` : `${v.payments.length} payments`, source: "Yahoo Finance (unofficial)", asOf: new Date(d.now()).toISOString(), actions: [instrumentAction(s, s)] };
    },
  },
  {
    name: "short_volume",
    description: "Daily short-sale volume share for a US stock over recent sessions (FINRA). High share = more short selling that day (not short interest).",
    params: { symbol: { type: "string", description: "US ticker", required: true } },
    async run(a, d) {
      const s = (str(a.symbol) ?? "").toUpperCase();
      const v = await d.shortVolume(s);
      return { data: v, summary: `${v.days.length} sessions`, source: v.source, asOf: v.days.at(-1) ? String((v.days.at(-1) as { date?: string }).date ?? "") || null : null, actions: [instrumentAction(s, s)] };
    },
  },
  {
    name: "earnings_calendar",
    description: "Upcoming earnings reports for the next few trading days (Nasdaq calendar): who reports, before open or after close, EPS forecast. Give symbols to filter, otherwise the largest companies are listed.",
    params: {
      days: { type: "integer", description: "Trading days ahead (default 5, max 10)" },
      symbols: { type: "string[]", description: "Only these tickers" },
    },
    async run(a, d) {
      const days = clamp(num(a.days), 1, 10, 5);
      const want = new Set(((a.symbols as string[] | undefined) ?? []).map((s) => s.toUpperCase()));
      const dates: string[] = [];
      const t = new Date(d.now());
      while (dates.length < days) {
        t.setUTCDate(t.getUTCDate() + 1);
        if (t.getUTCDay() !== 0 && t.getUTCDay() !== 6) dates.push(t.toISOString().slice(0, 10));
      }
      const rows = (await Promise.all(dates.map((x) => d.earningsOn(x).catch(() => [])))).flat();
      const pick = want.size ? rows.filter((r) => want.has(r.symbol)) : [...rows].sort((x, y) => (y.marketCap ?? 0) - (x.marketCap ?? 0)).slice(0, 20);
      return {
        data: { window: `${dates[0]} to ${dates.at(-1)}`, totalReporting: rows.length, reports: pick.map((r) => ({ date: r.date, symbol: r.symbol, name: r.name, when: r.when, epsForecast: r.epsForecast, yearAgoEps: r.lastYearEps })) },
        summary: `${pick.length} reports`,
        source: "Nasdaq earnings calendar (unofficial)",
        asOf: new Date(d.now()).toISOString(),
        actions: pick.slice(0, 5).map((r) => instrumentAction(r.symbol, r.name)),
      };
    },
  },
  {
    name: "news_headlines",
    description: "Latest news headlines on any topic or company from Google News (last few days): use to find WHY something happened.",
    params: {
      query: { type: "string", description: "Topic, e.g. 'Valero downgrade', 'Strait of Hormuz tanker'", required: true },
      days: { type: "integer", description: "Look back days (default 3, max 7)" },
    },
    async run(a, d) {
      const q = str(a.query) ?? "";
      const h = await d.headlines(q, clamp(num(a.days), 1, 7, 3));
      return {
        data: { query: q, headlines: h.map((x) => ({ title: x.title, source: x.source, published: x.published?.slice(0, 16) ?? null })) },
        summary: `${h.length} headlines`,
        source: "Google News RSS (headlines only)",
        asOf: h[0]?.published ?? null,
        links: h.slice(0, 5).map((x) => ({ label: x.source, url: x.url })),
      };
    },
  },
  {
    name: "daily_briefing",
    description: "Today's world briefing built from all events: top developments, what changed vs yesterday, sections by theme, what to watch.",
    params: {},
    async run(_a, d) {
      const { buildDailyBriefing } = await import("@/lib/briefing");
      const repo = await d.repo();
      const b = buildDailyBriefing(await repo.scan({ from: new Date(d.now() - 2 * 86_400_000).toISOString() }), d.now());
      const item = (i: { change: string; event: { title: string; countryName: string | null; importanceScore: number } }) => `${i.change}: ${i.event.title}${i.event.countryName ? ` (${i.event.countryName})` : ""}`;
      return {
        data: {
          top: b.topDevelopments.slice(0, 8).map(item),
          changes: b.changes,
          busiestCategories: b.comparison.sort((x, y) => y.today - x.today).slice(0, 6).map((c) => `${c.label}: ${c.today} today vs ${c.yesterday} yesterday`),
          sections: b.sections.slice(0, 6).map((s) => ({ title: s.title, items: s.items.slice(0, 3).map(item) })),
          whatToWatch: b.whatToWatch.slice(0, 5).map(item),
        },
        summary: `${b.topDevelopments.length} top developments`,
        source: "WorldView daily briefing (all sources)",
        asOf: b.generatedAt,
      };
    },
  },
  {
    name: "live_tracking",
    description: "Live positions from the map: ships (by AIS type: tankers, cargo…) or aircraft (incl. emergencies) in an area; military aircraft worldwide or in an area; the ISS; tracked satellites; aurora forecast.",
    params: {
      kind: { type: "string", description: "What to track", enum: ["ships", "aircraft", "military_aircraft", "iss", "satellites", "aurora"], required: true },
      place: { type: "string", description: "Place name, e.g. 'Strait of Hormuz', 'Taiwan', 'London' (needed for ships/aircraft)" },
      radius_km: { type: "number", description: "Override the search radius (km)" },
    },
    async run(a, d) {
      const kind = str(a.kind) as import("./world-data").TrackKind;
      const placeName = str(a.place);
      let place = placeName ? d.resolvePlace(placeName) : null;
      if (placeName && !place) throw new Error(`Unknown place "${placeName}"`);
      if (place && num(a.radius_km)) place = { ...place, radiusKm: clamp(num(a.radius_km), 10, 2000, place.radiusKm) };
      const data = await d.tracking(kind, place);
      return { data: data as object, summary: `${kind}${place ? ` near ${place.name}` : ""}`, source: "Live map layers (AIS, ADS-B via adsb.lol, wheretheiss.at, CelesTrak, NOAA SWPC)", asOf: (data as { observedAt?: string }).observedAt ?? null };
    },
  },
  {
    name: "infrastructure_near",
    description: "Critical infrastructure near a place: military bases, ports, power plants (incl. nuclear), oil/gas pipelines, undersea cables and landing points, data centers, LNG terminals — counts and the nearest ones.",
    params: {
      place: { type: "string", description: "Place name, e.g. 'Taiwan', 'Rotterdam', 'Strait of Hormuz'", required: true },
      types: { type: "string[]", description: "Subset of: bases, ports, power, nuclear, pipelines, cables, landing, datacenters, lng (default all)" },
      radius_km: { type: "number", description: "Radius in km (default depends on the place)" },
    },
    async run(a, d) {
      const name = str(a.place) ?? "";
      const place = d.resolvePlace(name);
      if (!place) throw new Error(`Unknown place "${name}"`);
      const all = ["bases", "ports", "power", "nuclear", "pipelines", "cables", "landing", "datacenters", "lng"] as const;
      const kinds = ((a.types as string[] | undefined) ?? []).filter((k): k is (typeof all)[number] => (all as readonly string[]).includes(k));
      const radius = clamp(num(a.radius_km), 10, 2000, place.radiusKm);
      const data = await d.infraNear(place.lat, place.lon, radius, kinds.length ? kinds : [...all]);
      return { data: { place: place.name, radiusKm: radius, ...(data as object) }, summary: `infrastructure within ${radius} km of ${place.name}`, source: "OpenStreetMap (ODbL), WRI Global Power Plant Database, NGA World Port Index", asOf: null };
    },
  },
  {
    name: "data_sources",
    description: "Every data source WorldView pulls from, with its category and whether it's working right now. Use to answer what data exists, or to find a source id for search_events.",
    params: {},
    async run(_a, d) {
      const s = await d.sourceHealth();
      return {
        data: { count: s.length, online: s.filter((x) => x.status === "ONLINE").length, sources: s.map((x) => ({ id: x.id, name: x.name, status: x.status, categories: x.categories.join(",") })) },
        summary: `${s.length} sources`,
        source: "WorldView source registry",
        asOf: new Date(d.now()).toISOString(),
      };
    },
  },
  {
    name: "movers",
    description: "Today's top US stock gainers, losers or most active.",
    params: { list: { type: "string", description: "Which list (default gainers)", enum: SCREENER_LISTS } },
    async run(a, d) {
      const list = (str(a.list) ?? "gainers") as ScreenerList;
      const r = await d.getScreener(list);
      const rows = r.rows.slice(0, 10);
      return {
        data: { list, rows: rows.map((x) => ({ symbol: x.symbol, name: x.name, price: x.price, changePct: x.changePct, volume: x.volume, marketCap: x.marketCap })) },
        summary: `${rows.length} ${list}`,
        source: r.source,
        asOf: r.asOf,
        actions: rows.slice(0, 5).map((x) => instrumentAction(x.symbol, x.name)),
      };
    },
  },
  {
    name: "find_instrument",
    description: "Look up ticker symbols by company or instrument name (any exchange).",
    params: { query: { type: "string", description: "Name, e.g. 'Toyota'", required: true } },
    async run(a, d) {
      const hits = (await d.searchInstruments(String(a.query))).slice(0, 8);
      return { data: { hits }, summary: `${hits.length} matches`, source: "Yahoo Finance search (unofficial)", asOf: null, actions: hits.slice(0, 3).map((h) => instrumentAction(h.symbol, h.name)) };
    },
  },

  // Macro and calendar
  {
    name: "macro_indicators",
    description: "Economic indicators (FRED, Treasury...): latest value, previous, change, date. Filter by group or a name keyword.",
    params: {
      group: { type: "string", description: "Group", enum: ["Inflation", "Jobs", "Growth", "Rates & credit", "Money & liquidity", "Housing", "Fiscal", "Global", "Crypto market", "Sentiment"] },
      query: { type: "string", description: "Name keyword, e.g. 'CPI', 'unemployment'" },
    },
    async run(a, d) {
      const m = await d.getMacroDashboard();
      const g = str(a.group);
      const q = str(a.query);
      const rows = m.indicators.filter((i) => (!g || i.group.toLowerCase() === g.toLowerCase()) && (!q || has(i.name, q) || has(i.id, q) || has(i.note, q)));
      return {
        data: {
          indicators: rows.map((i) => ({ name: i.name, group: i.group, value: i.value, unit: i.unit, previous: i.previous, change: i.change, changeBasis: i.changeBasis, label: i.label, asOf: i.asOf })),
          failed: m.failed,
        },
        summary: `${rows.length} indicators`,
        source: [...new Set(rows.map((i) => i.source))].slice(0, 4).join(", ") || "FRED, U.S. Treasury",
        asOf: latest(rows.map((i) => i.asOf)) ?? m.generatedAt,
        links: rows.slice(0, 4).map((i) => ({ label: i.name, url: i.sourceUrl })),
      };
    },
  },
  {
    name: "economic_calendar",
    description: "Scheduled US data releases (BLS, BEA) and Treasury auctions. Dates only, no forecasts.",
    params: { days: { type: "integer", description: "Days ahead (default 7, max 30)" } },
    async run(a, d) {
      const days = clamp(num(a.days), 1, 30, 7);
      const now = d.now();
      const items = (await d.getEconomicCalendar()).filter((i) => {
        const t = Date.parse(i.at);
        return t >= now - 86_400_000 && t <= now + days * 86_400_000;
      });
      const rows = items.sort((x, y) => x.at.localeCompare(y.at)).slice(0, 25);
      return {
        data: { items: rows.map((i) => ({ at: i.at, title: i.title, agency: i.agency, importance: i.importance })) },
        summary: `${rows.length} releases in ${days} d`,
        source: "BLS release schedule, BEA release dates, U.S. Treasury Fiscal Data",
        asOf: new Date(now).toISOString(),
      };
    },
  },

  // Positioning and markets
  {
    name: "cftc_positioning",
    description: "CFTC Commitments of Traders: speculators' net position (% of open interest), weekly change and 3-year percentile for 19 futures.",
    params: { market: { type: "string", description: "Filter, e.g. 'crude', 'gold', 'S&P', 'yen'" } },
    async run(a, d) {
      const r = await d.getCot();
      const m = str(a.market);
      const rows = r.rows.filter((x) => !m || has(x.name, m) || has(x.group, m));
      return {
        data: {
          reportDate: r.reportDate,
          rows: rows.map((x) => ({
            name: x.name,
            // Spelled out so a small model can't flip the sign.
            reading: `speculators net ${x.netSpec >= 0 ? "long" : "short"} ${Math.abs(x.netSpec).toLocaleString("en-US")} contracts (${x.netPctOi}% of open interest)${x.netChange === null ? "" : `; week-over-week net position ${x.netChange >= 0 ? "rose" : "fell"} by ${Math.abs(x.netChange).toLocaleString("en-US")}`}${x.percentile3y === null ? "" : `; ${x.percentile3y}th percentile of 3 years (100 = most long)`}`,
          })),
        },
        summary: `${rows.length} markets`,
        source: r.source,
        asOf: r.reportDate,
      };
    },
  },
  {
    name: "prediction_markets",
    description: "Kalshi prediction markets: implied probabilities of the leading outcomes and daily change.",
    params: { topic: { type: "string", description: "economics, financials, politics, world, or a keyword (e.g. 'Fed', 'recession')" } },
    async run(a, d) {
      const r = await d.getPredictionMarkets();
      const t = str(a.topic);
      const isGroup = !!t && (PM_TOPICS as readonly string[]).includes(t.toLowerCase());
      const evs = r.events.filter((e) => !t || (isGroup ? e.group === t.toLowerCase() : has(e.title, t) || has(e.category, t))).slice(0, 8);
      return {
        data: { events: evs.map((e) => ({ title: e.title, closes: e.closeTime, volume24h: e.volume24h, outcomes: e.outcomes.slice(0, 3).map((o) => ({ label: o.label, prob: o.prob, change: o.change })) })) },
        summary: `${evs.length} markets`,
        source: r.source,
        asOf: r.asOf,
        links: evs.slice(0, 5).map((e) => ({ label: cut(e.title, 50)!, url: e.url })),
      };
    },
  },
  {
    name: "crypto_markets",
    description: "Top cryptocurrencies by market cap: price, 24 h and 7 d change.",
    params: {},
    async run(_a, d) {
      const r = await d.getCryptoMarkets();
      const rows = r.rows.slice(0, 10);
      return {
        data: { rows: rows.map((x) => ({ symbol: x.symbol.toUpperCase(), name: x.name, price: x.price, change24h: x.change24h, change7d: x.change7d, marketCap: x.marketCap })) },
        summary: `${rows.length} coins`,
        source: r.source,
        asOf: r.asOf,
      };
    },
  },
  {
    name: "treasury_auctions",
    description: "Latest US Treasury auction results: rate, bid-to-cover, indirect-bidder share.",
    params: {},
    async run(_a, d) {
      const rows = (await d.getRecentAuctions()).slice(0, 10);
      return { data: { auctions: rows }, summary: `${rows.length} auctions`, source: "U.S. Treasury Fiscal Data", asOf: latest(rows.map((r) => r.date)) };
    },
  },
  {
    name: "yield_curve",
    description: "US Treasury yield curve (1 month to 30 years), latest vs one month earlier.",
    params: {},
    async run(_a, d) {
      const c = await d.getYieldCurve();
      const obj = (ys: Array<{ tenor: string; value: number | null }>) => Object.fromEntries(ys.map((y) => [y.tenor, y.value]));
      return {
        data: { latest: { date: c.latest.date, yields: obj(c.latest.yields) }, monthAgo: c.monthAgo ? { date: c.monthAgo.date, yields: obj(c.monthAgo.yields) } : null, unit: "%" },
        summary: `curve ${c.latest.date}`,
        source: "U.S. Treasury daily par yield curve",
        asOf: c.latest.date,
      };
    },
  },
  {
    name: "futures_curves",
    description: "Futures term structure for WTI, Brent, natural gas, gold and the VIX curve, labelled contango/backwardation.",
    params: { curve: { type: "string", description: "Filter, e.g. 'Brent', 'WTI', 'gas', 'gold', 'VIX'" } },
    async run(a, d) {
      const t = await d.getTermStructure();
      const f = str(a.curve);
      const curves = t.curves.filter((c) => !f || has(c.name, f) || has(c.id, f));
      return {
        data: { curves: curves.map((c) => ({ name: c.name, unit: c.unit, shape: c.shape, slopePct: c.slopePct, points: c.points.map((p) => [p.label, p.price]) })), failed: t.failed },
        summary: `${curves.length} curves`,
        source: t.source,
        asOf: latest(curves.flatMap((c) => c.points.map((p) => p.asOf))) ?? t.generatedAt,
      };
    },
  },

  // Companies and funds
  {
    name: "company_profile",
    description: "US-listed company from SEC filings: industry, latest-quarter fundamentals vs a year earlier, balance sheet, revenue trend, recent filings.",
    params: { ticker: { type: "string", description: "Ticker, e.g. NVDA", required: true } },
    async run(a, d) {
      const ticker = String(a.ticker).toUpperCase();
      const p = await d.companyProfile(ticker);
      if (!p) return { data: { ticker, found: false, note: "No SEC registrant for this ticker (non-US listings have prices only)." }, summary: "no SEC data", source: "SEC EDGAR" };
      return {
        data: {
          name: p.name,
          tickers: p.tickers,
          industry: p.industry,
          hq: p.hq,
          fiscalYearEnd: p.fiscalYearEnd,
          fundamentals: p.fundamentals.map((f) => ({ label: f.label, value: f.value, unit: f.unit, period: f.period, yearEarlier: f.priorValue })),
          balanceSheet: p.balanceSheet.map((b) => ({ label: b.label, value: b.value, unit: b.unit, asOf: b.asOf })),
          quarterlyRevenue: p.revenueHistory.slice(-6).map((r) => [r.end, r.value]),
          recentFilings: p.filings.slice(0, 6).map((f) => ({ form: f.form, filed: f.filed, description: cut(f.description, 80) })),
          annualReports: p.annualReports.slice(0, 2).map((r) => ({ form: r.form, filed: r.filed, period: r.period })),
          insiderFilings30d: p.insiderFilings30d,
        },
        summary: p.name,
        source: "SEC EDGAR submissions + XBRL company facts",
        asOf: latest([...p.fundamentals.map((f) => f.filed), ...p.filings.map((f) => f.filed)]),
        links: [{ label: `${p.name} on EDGAR`, url: p.secUrl }, ...(p.annualReports[0] ? [{ label: `${p.annualReports[0].form} filed ${p.annualReports[0].filed}`, url: p.annualReports[0].url }] : [])],
        actions: [instrumentAction(ticker, p.name)],
      };
    },
  },
  {
    name: "annual_report_analysis",
    description: "The app's analysis of the latest 10-K: fiscal-year figures vs prior year and AI summary of business, risks and outlook. Cached results only unless start=true.",
    params: {
      ticker: { type: "string", description: "Ticker", required: true },
      start: { type: "boolean", description: "Start an analysis if none is cached (slow; default false)" },
    },
    async run(a, d) {
      const ticker = String(a.ticker).toUpperCase();
      const p = await d.companyProfile(ticker);
      const report = p?.annualReports.find((r) => /^10-K/.test(r.form));
      if (!p || !report) return { data: { ticker, available: false, note: "No 10-K found for this ticker." }, summary: "no 10-K", source: "SEC EDGAR" };
      let s = await d.filingAnalysisStatus(report.accession);
      if (s.status === "none" && a.start === true) s = await d.startFilingAnalysis(ticker, report.accession);
      const links = [{ label: `${report.form} filed ${report.filed}`, url: report.url }];
      if (s.status !== "done" || !s.result) {
        return {
          data: { ticker, form: report.form, period: report.period, status: s.status, step: s.step, error: s.error, note: s.status === "none" ? "No cached analysis. It can be started from the instrument view (Annual reports → Analyze)." : undefined },
          summary: `analysis ${s.status}`,
          source: "SEC EDGAR 10-K",
          asOf: report.filed,
          links,
          actions: [instrumentAction(ticker, p.name)],
        };
      }
      const r = s.result;
      return {
        data: {
          company: r.company,
          form: r.form,
          period: r.period,
          mode: r.mode,
          figures: r.facts.lines.map((f) => ({ label: f.label, current: f.current, prior: f.prior, unit: f.unit, change: f.change })),
          ai: r.sections
            ? { businessSummary: cut(r.sections.businessSummary, 500), keyFinancialChanges: r.sections.keyFinancialChanges.slice(0, 4), topRisks: r.sections.topRisks.slice(0, 4), outlook: r.sections.outlook.slice(0, 3) }
            : null,
          aiNote: r.sections ? "AI sections are the app's earlier interpretation of the filing (not verified fact)." : undefined,
          notices: r.notices,
          generatedAt: r.generatedAt,
        },
        summary: `${r.form} ${r.period ?? ""}`.trim(),
        source: `SEC 10-K + XBRL${r.sections ? `; AI analysis (${r.provider}/${r.model})` : ""}`,
        asOf: r.filed,
        links: [{ label: `${r.form} filed ${r.filed}`, url: r.filingUrl }],
        actions: [instrumentAction(ticker, p.name)],
      };
    },
  },
  {
    name: "fund_holdings",
    description: "Latest 13F holdings of a tracked fund manager (e.g. Berkshire, Bridgewater, Pershing Square, Citadel, ARK): top positions, weights, quarter-over-quarter changes.",
    params: { manager: { type: "string", description: "Manager name or CIK", required: true } },
    async run(a, d) {
      const q = String(a.manager).trim();
      const m = /^\d+$/.test(q) ? d.trackedManagers.find((x) => Number(x.cik) === Number(q)) : d.trackedManagers.find((x) => has(x.label, q) || has(x.note, q));
      if (!m) return { data: { found: false, tracked: d.trackedManagers.map((x) => x.label) }, summary: "not tracked", source: "SEC 13F" };
      const h = await d.managerHoldings(m.cik, 25);
      if (!h) return { data: { manager: m.label, found: false }, summary: "no 13F", source: "SEC 13F" };
      return {
        data: {
          manager: h.label,
          period: h.latest.period,
          filed: h.latest.filed,
          totalValue: h.totalValue,
          positions: h.positionCount,
          counts: h.counts,
          top: h.holdings.slice(0, 15).map((x) => ({ issuer: x.issuer, ticker: x.ticker, putCall: x.putCall, weightPct: x.weight, value: x.value, change: x.change, sharesChangePct: x.sharesChangePct })),
          soldOut: h.soldOut.slice(0, 5).map((x) => ({ issuer: x.issuer, ticker: x.ticker, priorWeightPct: x.priorWeight })),
          caveat: "13F: long US positions only, filed up to 45 days after quarter end.",
        },
        summary: `${h.label} ${h.latest.period}`,
        source: "SEC EDGAR Form 13F-HR",
        asOf: h.latest.filed,
        links: [{ label: `${h.label} 13F`, url: h.latest.url }],
        actions: h.holdings.filter((x) => x.ticker).slice(0, 4).map((x) => instrumentAction(x.ticker!, x.issuer)),
      };
    },
  },
  {
    name: "held_by",
    description: "Which tracked funds held a ticker in their latest 13F, with weight and change.",
    params: { ticker: { type: "string", description: "Ticker", required: true } },
    async run(a, d) {
      const ticker = String(a.ticker).toUpperCase();
      const r = await d.holdersOf(ticker);
      const rows = r.holders.slice(0, 12);
      return {
        data: { ticker, checked: r.checked, of: r.total, pending: r.pending, holders: rows.map((h) => ({ fund: h.label, period: h.period, weightPct: h.weight, value: h.value, rank: h.rank, change: h.change, sharesChangePct: h.sharesChangePct })) },
        summary: `${r.holders.length} funds`,
        source: "SEC EDGAR Form 13F-HR",
        asOf: latest(rows.map((h) => h.period)),
        links: rows.slice(0, 3).map((h) => ({ label: `${h.label} 13F`, url: h.filingUrl })),
        actions: [instrumentAction(ticker)],
      };
    },
  },
  {
    name: "earnings_releases",
    description: "Earnings press releases filed with the SEC (8-K Item 2.02) in the last 7 days. Optionally filter by company or ticker.",
    params: { query: { type: "string", description: "Company or ticker filter" } },
    async run(a, d) {
      const f = await d.getEarningsReleases();
      const q = str(a.query);
      const rows = f.releases.filter((r) => !q || has(r.company, q) || r.ticker?.toUpperCase() === q.toUpperCase()).slice(0, 15);
      return {
        data: { from: f.from, to: f.to, total: f.releases.length, releases: rows.map((r) => ({ company: r.company, ticker: r.ticker, filed: r.filed, periodEnding: r.periodEnding })) },
        summary: `${rows.length} releases`,
        source: f.source,
        asOf: f.generatedAt,
        links: rows.slice(0, 4).map((r) => ({ label: `${r.ticker ?? r.company} 8-K`, url: r.url })),
        actions: rows.filter((r) => r.ticker).slice(0, 4).map((r) => instrumentAction(r.ticker!, r.company)),
      };
    },
  },
  {
    name: "ipo_filings",
    description: "New S-1 / F-1 registration statements (last 30 days), likely IPOs first.",
    params: { likely_ipo_only: { type: "boolean", description: "Only companies without a ticker (default true)" } },
    async run(a, d) {
      const all = await d.getRegistrations();
      const rows = all.filter((r) => a.likely_ipo_only === false || r.likelyIpo).slice(0, 15);
      return {
        data: { filings: rows.map((r) => ({ company: r.company, ticker: r.ticker, form: r.form, filed: r.filed, location: r.location })) },
        summary: `${rows.length} filings`,
        source: "SEC EDGAR full-text search",
        asOf: latest(rows.map((r) => r.filed)),
        links: rows.slice(0, 4).map((r) => ({ label: `${r.company} ${r.form}`, url: r.url })),
      };
    },
  },

  // World signals
  {
    name: "trends",
    description: "What people are searching and sharing: Google Trends by country (geo = ISO-2), or cross-country trends plus Hacker News.",
    params: { geo: { type: "string", description: "ISO-2 country code, e.g. US, GB, IN" } },
    async run(a, d) {
      const t = await d.getTrends();
      const geo = str(a.geo)?.toUpperCase();
      if (geo) {
        const c = t.google.find((x) => x.geo === geo);
        return {
          data: c ? { geo, country: c.name, searches: c.items.slice(0, 10).map((i) => ({ term: i.title, traffic: i.traffic, headline: i.news[0]?.title ?? null })) } : { geo, available: false },
          summary: c ? `${c.items.length} searches in ${geo}` : `no data for ${geo}`,
          source: "Google Trends daily RSS",
          asOf: t.generatedAt,
        };
      }
      return {
        data: {
          crossCountry: t.crossCountry.slice(0, 10).map((x) => ({ term: x.title, countries: x.geos, headline: x.news[0]?.title ?? null })),
          hackerNews: t.hackernews.slice(0, 5).map((h) => ({ title: h.title, points: h.points })),
        },
        summary: `${t.crossCountry.length} cross-country trends`,
        source: "Google Trends, Hacker News",
        asOf: t.generatedAt,
      };
    },
  },
  {
    name: "energy_grids",
    description: "Live electricity grids (GB, Spain, France, Germany, Australia NEM): demand, wholesale price, renewable share, carbon intensity, generation mix.",
    params: { grid: { type: "string", description: "GB, ES, FR, DE or NEM" } },
    async run(a, d) {
      const e = await d.getEnergy();
      const g = str(a.grid)?.toUpperCase();
      const grids = e.grids.filter((x) => !g || x.id === g);
      const metric = (m: { value: number; unit: string; asOf: string } | null) => (m ? `${m.value} ${m.unit}` : null);
      return {
        data: {
          grids: grids.map((x) => ({
            grid: x.name,
            demand: metric(x.demand),
            price: metric(x.price),
            renewableShare: metric(x.renewableShare),
            carbonIntensity: metric(x.carbonIntensity),
            topFuels: x.mix?.fuels.slice().sort((p, q) => q.share - p.share).slice(0, 4).map((f) => `${f.label} ${f.share}%`),
            stale: x.stale || undefined,
            missing: x.missing,
          })),
          failed: e.failed,
        },
        summary: `${grids.length} grids`,
        source: grids.map((x) => x.source).join(", ") || "grid operators",
        asOf: latest(grids.flatMap((x) => [x.demand?.asOf, x.price?.asOf])) ?? e.generatedAt,
      };
    },
  },
  {
    name: "planet",
    description: "Climate and space-weather indicators (CO2, temperature, sea ice, ENSO, geomagnetic Kp) and asteroid close approaches.",
    params: {},
    async run(_a, d) {
      const p = await d.getPlanetDashboard();
      return {
        data: {
          indicators: p.indicators.map((i) => ({ name: i.name, value: i.value, unit: i.unit, change: i.change, changeBasis: i.changeBasis, label: i.label, asOf: i.asOf })),
          approaches: p.approaches.slice(0, 3),
          failed: p.failed,
        },
        summary: `${p.indicators.length} indicators`,
        source: "NOAA, NSIDC, NASA JPL",
        asOf: latest(p.indicators.map((i) => i.asOf)) ?? p.generatedAt,
      };
    },
  },
  {
    name: "chokepoints",
    description: "Disruption monitor for shipping chokepoints (Hormuz, Suez/Red Sea, Malacca, Panama, Bosporus...): score, level and top events nearby.",
    params: { days: { type: "integer", description: "Window in days (default 7, max 30)" } },
    async run(a, d) {
      const days = clamp(num(a.days), 1, 30, 7);
      const m = await d.getChokepointMonitor(days);
      const cps = m.chokepoints.slice().sort((x, y) => y.score - x.score);
      return {
        data: { days, chokepoints: cps.map((c) => ({ name: c.name, connects: c.connects, level: c.level, score: c.score, events: c.total, top: c.top.slice(0, 2).map((e) => ({ id: e.id, title: cut(e.title, 100), time: e.timestamp })) })) },
        summary: `${cps.filter((c) => c.level !== "calm").length} not calm`,
        source: "WorldView chokepoint monitor (events within each strait's radius)",
        asOf: m.generatedAt,
        actions: cps.slice(0, 3).flatMap((c) => c.top.slice(0, 1).map((e) => ({ kind: "event" as const, id: e.id, lat: c.lat, lon: c.lon, label: c.name }))),
      };
    },
  },
  {
    name: "travel_advisories",
    description: "Recent government travel-advisory changes (US, UK, Canada, Australia). Optionally for one country.",
    params: { country: { type: "string", description: "Country name or ISO-2 code" } },
    async run(a, d) {
      const s = await d.getSecurityDashboard();
      const c = str(a.country);
      const code = c ? d.findCountry(c)?.code : undefined;
      const rows = s.advisories.filter((x) => !c || (code ? x.country === code : has(x.place, c))).slice(0, 15);
      return {
        data: { advisories: rows.map((x) => ({ government: x.government, place: x.place, advice: cut(x.advice, 160), updatedAt: x.updatedAt })) },
        summary: `${rows.length} advisories`,
        source: "US State Dept, UK FCDO, Canada, Smartraveller",
        asOf: latest(rows.map((x) => x.updatedAt)) ?? s.generatedAt,
        links: rows.flatMap((x) => (x.url ? [{ label: `${x.government}: ${x.place}`, url: x.url }] : [])).slice(0, 4),
      };
    },
  },
  {
    name: "cyber",
    description: "Cyber threat picture: CISA known-exploited vulnerabilities (latest additions) and critical CVEs from the last 7 days.",
    params: { query: { type: "string", description: "Vendor/product filter, e.g. 'Microsoft'" } },
    async run(a, d) {
      const s = await d.getSecurityDashboard();
      const q = str(a.query);
      const kev = (s.kev?.latest ?? []).filter((k) => !q || has(k.vendor, q) || has(k.product, q)).slice(0, 6);
      const cves = s.cves.filter((c) => !q || has(c.vendor, q) || has(c.product, q) || has(c.description, q)).slice(0, 8);
      return {
        data: {
          kev: s.kev ? { total: s.kev.total, addedLast7d: s.kev.addedLast7d, latest: kev.map((k) => ({ cve: k.cveId, vendor: k.vendor, product: k.product, name: k.name, added: k.dateAdded, ransomware: k.ransomware || undefined })) } : null,
          criticalCves: cves.map((c) => ({ id: c.id, score: c.score, vendor: c.vendor, product: c.product, description: cut(c.description, 140), knownExploited: c.knownExploited || undefined })),
          failed: s.failed,
        },
        summary: `${kev.length} KEV, ${cves.length} CVEs`,
        source: "CISA KEV catalog, NIST NVD",
        asOf: s.generatedAt,
        links: kev.slice(0, 3).map((k) => ({ label: k.cveId, url: k.url })),
      };
    },
  },
  {
    name: "country_profile",
    description: "Country profile: macro statistics (GDP, inflation, unemployment, debt, rates...), leaders, currency, plus its events in the app.",
    params: { country: { type: "string", description: "Country name or ISO-2 code", required: true } },
    async run(a, d) {
      const c = d.findCountry(String(a.country));
      if (!c) return { data: { found: false }, summary: "unknown country", source: "WorldView gazetteer" };
      const [p, repo] = await Promise.all([d.getCountryProfile(c.code), d.repo()]);
      const since = new Date(d.now() - 7 * 86_400_000).toISOString();
      const events = (await repo.query({ country: c.code, from: since, sort: "importance", limit: 6 })).events;
      return {
        data: {
          country: p.name,
          code: c.code,
          stats: p.stats.map((s) => ({ label: s.label, value: s.value, unit: s.unit, period: s.period, source: s.source })),
          facts: p.facts ? { capital: p.facts.capital, currencies: p.facts.currencies.map((x) => x.code ?? x.name), headOfState: p.facts.headOfState, headOfGovernment: p.facts.headOfGovernment } : null,
          topEvents7d: events.map(compactEvent),
        },
        summary: p.name,
        source: [...new Set(p.stats.map((s) => s.source))].join(", ") + "; WorldView events",
        asOf: p.generatedAt,
        actions: [{ kind: "country", code: c.code, label: p.name }, ...events.slice(0, 3).map(eventAction)],
      };
    },
  },
];

export const TOOL_NAMES = TOOLS.map((t) => t.name);
export const toolByName = (name: string) => TOOLS.find((t) => t.name === name);

// ─── Argument validation ─────────────────────────────────────────────────────

function paramSchema(p: ParamSpec): z.ZodType {
  switch (p.type) {
    case "string":
      return p.enum ? z.preprocess((v) => (typeof v === "string" ? (p.enum!.find((e) => e.toLowerCase() === v.toLowerCase()) ?? v) : v), z.enum(p.enum as [string, ...string[]])) : z.string().trim().min(1).max(200);
    case "number":
      return z.coerce.number().finite();
    case "integer":
      return z.coerce.number().finite().transform(Math.round);
    case "boolean":
      return z.preprocess((v) => (v === "true" ? true : v === "false" ? false : v), z.boolean());
    case "string[]":
      return z.preprocess(
        (v) => (typeof v === "string" ? v.split(/[,\s]+/) : v),
        z.array(z.string().trim().max(20)).transform((xs) => xs.filter(Boolean)).pipe(z.array(z.string()).min(1).max(MAX_SYMBOLS * 2)),
      );
  }
}

/** Validate and normalise tool arguments. Nulls / empty strings count as "not given". */
export function validateArgs(def: ToolDef, raw: unknown): { ok: true; args: Record<string, unknown> } | { ok: false; error: string } {
  const input = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const args: Record<string, unknown> = {};
  for (const [key, spec] of Object.entries(def.params)) {
    const v = input[key];
    if (v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0)) {
      if (spec.required) return { ok: false, error: `${def.name}: missing required argument "${key}"` };
      continue;
    }
    const parsed = paramSchema(spec).safeParse(v);
    if (!parsed.success) {
      if (spec.required) return { ok: false, error: `${def.name}: invalid "${key}" (${parsed.error.issues[0]?.message ?? "invalid"})` };
      continue; // drop a bad optional argument rather than failing the call
    }
    args[key] = parsed.data;
  }
  return { ok: true, args };
}

/** "get_quote(NVDA, AMD)" — the call as shown to the user and in citations. */
export function describeCall(name: string, args: Record<string, unknown>): string {
  const parts = Object.entries(args).map(([k, v]) => (Array.isArray(v) ? v.join(", ") : k === "query" || k === "symbol" || k === "ticker" || k === "id" || k === "event_id" || k === "country" || k === "manager" ? String(v) : `${k}=${String(v)}`));
  return `${name}(${parts.join(", ")})`;
}

// ─── Schemas for the model ───────────────────────────────────────────────────

function jsonType(p: ParamSpec): Record<string, unknown> {
  if (p.type === "string[]") return { type: "array", items: { type: "string" }, description: p.description };
  return { type: p.type, description: p.description, ...(p.enum ? { enum: [...p.enum] } : {}) };
}

/** JSON Schema for hosted tool use. */
export function inputSchema(def: ToolDef): { type: "object"; properties: Record<string, unknown>; required: string[] } {
  return {
    type: "object",
    properties: Object.fromEntries(Object.entries(def.params).map(([k, p]) => [k, jsonType(p)])),
    required: Object.entries(def.params).filter(([, p]) => p.required).map(([k]) => k),
  };
}

/** One-line signatures for the local model's prompt: get_quote(symbols: string[]) — … */
export function toolCatalog(defs: ToolDef[] = TOOLS): string {
  return defs
    .map((t) => {
      const ps = Object.entries(t.params).map(([k, p]) => `${k}${p.required ? "" : "?"}: ${p.enum ? p.enum.map((e) => `"${e}"`).join("|") : p.type}`);
      return `- ${t.name}(${ps.join(", ")}): ${t.description}`;
    })
    .join("\n");
}
