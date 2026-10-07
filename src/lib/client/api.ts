/** Typed client for WorldView's internal API. */
import type { AIInterpretation, EventSummary, WorldEvent } from "@/types/events";
import type { IngestionRun } from "@/lib/db/types";

export interface EventsResponse {
  mode: "live" | "demo";
  total: number;
  version: number;
  generatedAt: string;
  events: EventSummary[];
}

export interface RelatedEvent {
  event: EventSummary;
  relation: string;
  basis: string;
}

export interface EventDetailResponse {
  event: WorldEvent;
  related: RelatedEvent[];
  marketExposure: import("@/lib/finance/types").ExposureLink[];
}

export interface CountryResponse {
  country: {
    code: string;
    name: string;
    nameLong: string | null;
    region: string | null;
    subregion: string | null;
    population: number | null;
    bbox: [number, number, number, number] | null;
    label: [number, number] | null;
  };
  totalEvents: number;
  highImportance: number;
  last24h: number;
  byCategory24h: Record<string, number>;
  topEvents: EventSummary[];
  recentEvents: EventSummary[];
}

export interface SourceHealth {
  id: string;
  name: string;
  description: string;
  homepage: string;
  attribution: string;
  categories: string[];
  status: "ONLINE" | "ERROR" | "DEGRADED" | "PENDING" | "DISABLED" | "RUNNING";
  disabledReason: string | null;
  refreshIntervalMs: number;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  nextRunAt: string | null;
  lastRun: IngestionRun | null;
  consecutiveFailures: number;
}

export interface SourcesResponse {
  mode: "live" | "demo";
  repository: string;
  eventCount: number;
  sources: SourceHealth[];
  runs: IngestionRun[];
}

export interface MetaResponse {
  mode: "live" | "demo";
  ai: {
    enabled: boolean;
    provider: string | null;
    model: string | null;
    reason: string | null;
    local:
      | { state: "not-downloaded" | "downloaded" | "loading" | "ready" }
      | { state: "downloading"; downloadedBytes: number; totalBytes: number }
      | { state: "error"; message: string }
      | null;
  };
  repository: string;
  version: number;
}

export interface SearchResponse {
  query: string;
  intent: SearchIntent | null;
  locations: Array<{ kind: "country" | "state" | "city" | "region"; code: string | null; name: string; detail: string; lat: number; lon: number; zoom: number; bbox: [number, number, number, number] | null }>;
  /** Local gazetteer places (countries, states, cities, airports) */
  places: import("@/lib/geo/place-search").PlaceResult[];
  events: EventSummary[];
  topics: Array<{ id: string; label: string; detail: string; categories: string[] }>;
}

export interface GeocodeResponse {
  query: string;
  results: import("@/lib/geo/place-search").PlaceResult[];
  cached: boolean;
  attribution: string;
}

export interface SearchIntent {
  source: "rules" | "ai";
  explanation: string | null;
  categories: string[];
  range: string | null;
  minMagnitude: number | null;
  place: { name: string; lat: number; lon: number; zoom: number; country: string | null } | null;
  description: string;
}

export type { DailyBriefing, BriefingItem } from "@/lib/briefing";
import type { MarketSnapshot, Quote, ExposureLink } from "@/lib/finance/types";
export type { MarketSnapshot, Quote, ExposureLink };

export interface CalendarItem {
  id: string;
  at: string;
  title: string;
  agency: "BLS" | "BEA" | "Treasury";
  importance: "high" | "medium" | "low";
  url: string;
  detail: string | null;
}

export interface YieldCurveResponse {
  latest: { date: string; yields: Array<{ tenor: string; value: number | null }> };
  monthAgo: { date: string; yields: Array<{ tenor: string; value: number | null }> } | null;
}

export interface InstrumentResponse {
  symbol: string;
  range: string;
  history:
    | {
        name: string;
        currency: string | null;
        exchange: string | null;
        instrumentType: string | null;
        points: Array<[number, number]>;
        previousClose: number | null;
        dayHigh: number | null;
        dayLow: number | null;
        fiftyTwoWeekHigh: number | null;
        fiftyTwoWeekLow: number | null;
        volume: number | null;
        marketTime: string | null;
      }
    | { error: string };
  company: {
    cik: string;
    name: string;
    tickers: string[];
    exchanges: string[];
    industry: string | null;
    hq: string | null;
    filings: Array<{ form: string; filed: string; description: string; url: string }>;
    insiderFilings30d: number;
    fundamentals: Array<{ label: string; value: number; unit: string; period: string; priorValue: number | null; filed: string }>;
    balanceSheet?: import("@/lib/finance/company").BalanceItem[];
    revenueHistory?: import("@/lib/finance/company").QuarterValue[];
    secUrl: string;
  } | null;
  events: EventSummary[];
  note: string;
}

async function getJSON<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal, cache: "no-store" });
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (body?.error) msg = body.error;
    } catch {}
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

export const api = {
  events: (params: Record<string, string>, signal?: AbortSignal) =>
    getJSON<EventsResponse>(`/api/events?${new URLSearchParams(params)}`, signal),
  event: (id: string, signal?: AbortSignal) => getJSON<EventDetailResponse>(`/api/events/${encodeURIComponent(id)}`, signal),
  country: (code: string, signal?: AbortSignal) => getJSON<CountryResponse>(`/api/countries/${encodeURIComponent(code)}`, signal),
  countryProfile: (code: string, signal?: AbortSignal) =>
    getJSON<import("@/lib/country-profile").CountryProfile>(`/api/countries/${encodeURIComponent(code)}/profile`, signal),
  briefing: (signal?: AbortSignal) =>
    getJSON<
      import("@/lib/briefing").DailyBriefing & {
        /** Today's scheduled morning briefing, if the daily job has run */
        morning?: { date: string; generatedAt: string; trigger: "scheduled" | "manual" } | null;
      }
    >("/api/briefing", signal),
  async briefingNarrative(): Promise<NonNullable<import("@/lib/briefing").DailyBriefing["aiNarrative"]>> {
    const res = await fetch("/api/briefing/narrative", { method: "POST" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body?.error ?? `Request failed (${res.status})`);
    return body.aiNarrative;
  },
  markets: (signal?: AbortSignal) => getJSON<MarketSnapshot>("/api/markets", signal),
  quotes: (symbols: string[], signal?: AbortSignal) =>
    getJSON<{ quotes: Quote[] }>(`/api/markets/quote?symbols=${encodeURIComponent(symbols.join(","))}`, signal),
  movers: (signal?: AbortSignal) =>
    getJSON<{ movers: Array<{ event: EventSummary; exposure: ExposureLink[] }>; note: string }>("/api/markets/movers", signal),
  instrument: (symbol: string, range: string, signal?: AbortSignal) =>
    getJSON<InstrumentResponse>(`/api/markets/instrument/${encodeURIComponent(symbol)}?range=${range}`, signal),
  calendar: (signal?: AbortSignal) => getJSON<{ items: CalendarItem[]; sources: string[] }>("/api/markets/calendar?days=14", signal),
  screener: (list: "gainers" | "losers" | "active", signal?: AbortSignal) =>
    getJSON<import("@/lib/finance/screeners").ScreenerResult>(`/api/markets/screener?list=${list}`, signal),
  searchInstruments: (q: string, signal?: AbortSignal) =>
    getJSON<{ hits: import("@/lib/finance/search").SearchHit[] }>(`/api/markets/search?q=${encodeURIComponent(q)}`, signal),
  shortVolume: (symbol: string, signal?: AbortSignal) =>
    getJSON<import("@/lib/finance/short-volume").ShortVolume>(`/api/markets/short-volume/${encodeURIComponent(symbol)}`, signal),
  ipos: (signal?: AbortSignal) => getJSON<{ filings: import("@/lib/finance/ipos").Registration[]; source: string }>("/api/markets/ipos", signal),
  predictions: (signal?: AbortSignal) => getJSON<import("@/lib/finance/prediction-markets").PredictionMarkets>("/api/markets/predictions", signal),
  auctions: (signal?: AbortSignal) => getJSON<{ auctions: import("@/lib/finance/auctions").AuctionResult[]; source: string }>("/api/markets/auctions", signal),
  earnings: (signal?: AbortSignal) => getJSON<import("@/lib/finance/earnings").EarningsFeed>("/api/markets/earnings", signal),
  termStructure: (signal?: AbortSignal) => getJSON<import("@/lib/finance/term-structure").TermStructure>("/api/markets/term-structure", signal),
  dividends: (symbol: string, signal?: AbortSignal) =>
    getJSON<import("@/lib/finance/dividends").Dividends>(`/api/markets/dividends/${encodeURIComponent(symbol)}`, signal),
  planet: (signal?: AbortSignal) => getJSON<import("@/lib/planet").PlanetDashboard>("/api/planet", signal),
  energy: (signal?: AbortSignal) => getJSON<import("@/lib/energy").EnergyDashboard>("/api/energy", signal),
  cyber: (signal?: AbortSignal) => getJSON<import("@/lib/cyber").SecurityDashboard>("/api/cyber", signal),
  trends: (signal?: AbortSignal) => getJSON<import("@/lib/trends").Trends>("/api/trends", signal),
  countryTrends: (geo: string, signal?: AbortSignal) =>
    getJSON<{ geo: string; country: import("@/lib/trends").GoogleCountry | null; generatedAt: string }>(`/api/trends?geo=${encodeURIComponent(geo)}`, signal),
  positioning: (signal?: AbortSignal) => getJSON<import("@/lib/finance/cot").CotReport>("/api/markets/positioning", signal),
  crypto: (signal?: AbortSignal) => getJSON<import("@/lib/finance/crypto").CryptoMarkets>("/api/markets/crypto", signal),
  macro: (signal?: AbortSignal) => getJSON<import("@/lib/finance/macro").MacroDashboard>("/api/markets/macro", signal),
  yieldCurve: (signal?: AbortSignal) => getJSON<YieldCurveResponse>("/api/markets/yield-curve", signal),
  reaction: (symbols: string[], since: string, signal?: AbortSignal) =>
    getJSON<{ since: string; results: Array<{ symbol: string; changePct: number | null; fromTime: string | null }>; note: string }>(
      `/api/markets/reaction?symbols=${encodeURIComponent(symbols.join(","))}&since=${encodeURIComponent(since)}`,
      signal,
    ),
  async marketSummary() {
    const res = await fetch("/api/markets/summary", { method: "POST" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body?.error ?? `Request failed (${res.status})`);
    return body as { summary: { text: string; provider: string; model: string; generatedAt: string }; disclaimer: string };
  },
  sources: (signal?: AbortSignal) => getJSON<SourcesResponse>("/api/sources", signal),
  meta: (signal?: AbortSignal) => getJSON<MetaResponse>("/api/meta", signal),
  /** Online place search (Photon by komoot, proxied + cached by our server) */
  geocode: (q: string, signal?: AbortSignal) => getJSON<GeocodeResponse>(`/api/geocode?q=${encodeURIComponent(q)}`, signal),
  search: (q: string, signal?: AbortSignal, ai = false) =>
    getJSON<SearchResponse>(`/api/search?q=${encodeURIComponent(q)}${ai ? "&ai=1" : ""}`, signal),
  async interpret(id: string): Promise<AIInterpretation> {
    const res = await fetch(`/api/events/${encodeURIComponent(id)}/interpret`, { method: "POST" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body?.error ?? `Request failed (${res.status})`);
    return body.aiInterpretation as AIInterpretation;
  },
  async setupLocalAI() {
    const res = await fetch("/api/ai/setup", { method: "POST" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body?.error ?? `Request failed (${res.status})`);
    return body;
  },
  async ingest(source: string) {
    const res = await fetch(`/api/ingest/${encodeURIComponent(source)}`, { method: "POST" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok && !body?.run) throw new Error(body?.error ?? `Request failed (${res.status})`);
    return body.run as IngestionRun;
  },
};
