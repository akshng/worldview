/**
 * Online geocoding via Photon by komoot (https://photon.komoot.io) — keyless,
 * OpenStreetMap-based, and (unlike nominatim.openstreetmap.org) fine for
 * type-ahead under fair use. Requests are proxied through /api/geocode with a
 * descriptive User-Agent, cached for 24 h per query and rate-limited both per
 * client and globally so one browser can't hammer the shared service.
 */
import "server-only";
import { userAgent } from "@/lib/env";
import { enrichOnlineResults } from "./place-index";
import { GEOCODE_MIN_CHARS, PHOTON_ATTRIBUTION, parsePhoton, type PlaceResult } from "./place-search";

const PHOTON_URL = "https://photon.komoot.io/api/";
const TTL_MS = 24 * 3_600_000;
const MAX_ENTRIES = 2_000;
/** Upstream calls per minute, across all clients (fair use of a free service) */
const GLOBAL_PER_MIN = 60;
/** Requests per minute per client (cache hits included) */
const CLIENT_PER_MIN = 40;

interface State {
  cache: Map<string, { at: number; results: PlaceResult[] }>;
  upstream: number[];
  clients: Map<string, number[]>;
  inflight: Map<string, Promise<PlaceResult[]>>;
}
function state(): State {
  const g = globalThis as unknown as { __wvGeocode?: State };
  g.__wvGeocode ??= { cache: new Map(), upstream: [], clients: new Map(), inflight: new Map() };
  return g.__wvGeocode;
}

export class RateLimitError extends Error {
  constructor(public retryAfterSec: number) {
    super("Too many geocoding requests — try again shortly.");
  }
}

/** Sliding one-minute window: true when another hit is allowed (and records it). */
export function takeSlot(log: number[], perMin: number, now = Date.now()): boolean {
  while (log.length && now - log[0] > 60_000) log.shift();
  if (log.length >= perMin) return false;
  log.push(now);
  return true;
}

export const cacheKey = (q: string) => q.trim().toLowerCase().replace(/\s+/g, " ");

export interface GeocodeResponse {
  query: string;
  results: PlaceResult[];
  cached: boolean;
  attribution: string;
}

export async function geocode(q: string, client = "local", fetchImpl: typeof fetch = fetch): Promise<GeocodeResponse> {
  const query = q.trim().slice(0, 200);
  const base = { query, attribution: PHOTON_ATTRIBUTION };
  if (query.length < GEOCODE_MIN_CHARS) return { ...base, results: [], cached: false };
  const s = state();

  const clientLog = s.clients.get(client) ?? [];
  s.clients.set(client, clientLog);
  if (!takeSlot(clientLog, CLIENT_PER_MIN)) throw new RateLimitError(Math.ceil((60_000 - (Date.now() - clientLog[0])) / 1000));
  if (s.clients.size > 5_000) s.clients.clear();

  const key = cacheKey(query);
  const hit = s.cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return { ...base, results: hit.results, cached: true };

  let pending = s.inflight.get(key);
  if (!pending) {
    if (!takeSlot(s.upstream, GLOBAL_PER_MIN)) throw new RateLimitError(Math.ceil((60_000 - (Date.now() - s.upstream[0])) / 1000));
    pending = (async () => {
      const url = `${PHOTON_URL}?${new URLSearchParams({ q: query, limit: "8", lang: "en" })}`;
      const res = await fetchImpl(url, {
        headers: { "User-Agent": `${userAgent()} place-search`, Accept: "application/json" },
        signal: AbortSignal.timeout(8_000),
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`Photon HTTP ${res.status}`);
      const results = enrichOnlineResults(parsePhoton(await res.json()));
      s.cache.delete(key);
      s.cache.set(key, { at: Date.now(), results });
      // Map keeps insertion order: drop the oldest entries.
      while (s.cache.size > MAX_ENTRIES) s.cache.delete(s.cache.keys().next().value!);
      return results;
    })().finally(() => s.inflight.delete(key));
    s.inflight.set(key, pending);
  }
  return { ...base, results: await pending, cached: false };
}
