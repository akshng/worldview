/**
 * Small helpers shared by the institutional-feed connectors (central banks, sanctions,
 * status pages, recalls, …). Feeds are read with the news-rss XML reader; no extra dependency.
 */
import type { EventSource, SourceAssertion, SourceType } from "@/types/events";
import { placesInText } from "@/lib/geo/headline-places";
import { mapLimited, parseFeedXml } from "./news-rss/client";
import type { RssItem } from "./news-rss/types";
import { httpGet, type FetchContext } from "./types";

export type { RssItem };

/** Places used when a record has no location of its own: the publisher's headquarters. */
export const HQ = {
  federalReserve: { lat: 38.8928, lon: -77.0458, name: "Federal Reserve Board, Washington, DC", country: "US" },
  ecb: { lat: 50.1095, lon: 8.7033, name: "European Central Bank, Frankfurt", country: "DE" },
  bankOfEngland: { lat: 51.5142, lon: -0.0886, name: "Bank of England, London", country: "GB" },
  bankOfJapan: { lat: 35.6866, lon: 139.7713, name: "Bank of Japan, Tokyo", country: "JP" },
  bankOfCanada: { lat: 45.4215, lon: -75.7003, name: "Bank of Canada, Ottawa", country: "CA" },
  reserveBankOfAustralia: { lat: -33.8678, lon: 151.2111, name: "Reserve Bank of Australia, Sydney", country: "AU" },
  reserveBankOfIndia: { lat: 18.9322, lon: 72.8354, name: "Reserve Bank of India, Mumbai", country: "IN" },
  treasury: { lat: 38.8981, lon: -77.0344, name: "U.S. Treasury, Washington, DC", country: "US" },
  euCouncil: { lat: 50.8423, lon: 4.3817, name: "Council of the EU, Brussels", country: "BE" },
  ukGov: { lat: 51.5033, lon: -0.1276, name: "Whitehall, London", country: "GB" },
  unHq: { lat: 40.7489, lon: -73.968, name: "United Nations Headquarters, New York", country: "US" },
  fda: { lat: 39.0346, lon: -76.9834, name: "U.S. FDA, Silver Spring, MD", country: "US" },
  cpsc: { lat: 38.9847, lon: -77.0947, name: "U.S. CPSC, Bethesda, MD", country: "US" },
  hibp: { lat: -28.0167, lon: 153.4, name: "Have I Been Pwned, Gold Coast, Australia", country: "AU" },
  sec: { lat: 38.8973, lon: -77.0063, name: "U.S. SEC, Washington, DC", country: "US" },
  nasdaq: { lat: 40.757, lon: -73.9859, name: "Nasdaq MarketSite, New York", country: "US" },
  nyse: { lat: 40.7069, lon: -74.0113, name: "New York Stock Exchange, New York", country: "US" },
  ecdc: { lat: 59.3598, lon: 17.9989, name: "ECDC, Solna (Stockholm)", country: "SE" },
  iaea: { lat: 48.2349, lon: 16.4162, name: "IAEA, Vienna International Centre", country: "AT" },
} as const;
export type Place = { lat: number; lon: number; name: string; country: string };

/**
 * The place a headline names (a cued mention first), skipping the issuer's own countries.
 * Returns null when the headline names none — callers then use the issuer's HQ.
 */
export function placeInTitle(title: string, avoid: readonly string[] = []): { lat: number; lon: number; precision: "city" | "country"; name: string; country: string } | null {
  const places = placesInText(title).filter((p) => !avoid.includes(p.country.code));
  const p = places.find((x) => x.cued) ?? places[0];
  if (!p) return null;
  return p.city
    ? { lat: p.city.lat, lon: p.city.lon, precision: "city", name: `${p.city.name}, ${p.country.name}`, country: p.country.code }
    : { lat: p.country.label[1], lon: p.country.label[0], precision: "country", name: p.country.name, country: p.country.code };
}

/** FNV-1a, base 36: a short stable id from a URL or composite key. */
export function hashId(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

export function isoOrNull(s: string | null | undefined): string | null {
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

/**
 * Wall-clock time in an IANA zone → UTC, using the platform time-zone database (handles DST).
 * Upstream feeds that print local times without an offset (Nasdaq, TreasuryDirect, IAEA) need this.
 */
export function zonedToUtc(timeZone: string, y: number, mo: number, d: number, h: number, mi: number, s = 0): Date {
  const wanted = Date.UTC(y, mo - 1, d, h, mi, s);
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const shownAt = (ms: number) => {
    const p = Object.fromEntries(fmt.formatToParts(new Date(ms)).filter((x) => x.type !== "literal").map((x) => [x.type, Number(x.value)]));
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  };
  // Two passes settle the offset, also next to a DST change.
  let guess = wanted - (shownAt(wanted) - wanted);
  guess += wanted - shownAt(guess);
  return new Date(guess);
}

export function clip(s: string, max = 290): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

export function makeSource(o: {
  dataSourceId: string;
  externalId: string;
  sourceName: string;
  sourceUrl: string | null;
  title: string | null;
  publishedAt: string | null;
  retrievedAt: string;
  sourceType?: SourceType;
  assertion?: SourceAssertion;
  basis: string;
}): EventSource {
  return {
    id: `${o.dataSourceId}:${o.externalId}`,
    dataSourceId: o.dataSourceId,
    externalId: o.externalId,
    sourceName: o.sourceName,
    sourceUrl: o.sourceUrl,
    title: o.title,
    titleIsDerived: false,
    publishedAt: o.publishedAt,
    retrievedAt: o.retrievedAt,
    sourceType: o.sourceType ?? "OFFICIAL_AGENCY",
    assertion: o.assertion ?? "OFFICIAL_FINAL",
    credibility: { basis: o.basis },
  };
}

const FEED_TIMEOUT_MS = 15_000;

/**
 * Fetch several feeds (XML or JSON) at once. A failing feed only loses itself; the run fails
 * only if every feed fails.
 */
export async function fetchEach<F extends { id: string; url: string }, R>(
  ctx: FetchContext,
  feeds: readonly F[],
  read: (res: Response, feed: F) => Promise<R>,
  accept = "application/rss+xml, application/atom+xml, application/xml, text/xml",
): Promise<Array<{ feed: F; data: R }>> {
  const results = await mapLimited([...feeds], 6, async (feed) => {
    const signal = AbortSignal.any([ctx.signal, AbortSignal.timeout(FEED_TIMEOUT_MS)]);
    const res = await httpGet(feed.url, { ...ctx, signal }, { accept });
    return { feed, data: await read(res, feed) };
  });
  const ok = results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
  if (!ok.length && feeds.length) {
    const reasons = results.map((r, i) => (r.status === "rejected" ? `${feeds[i].id}: ${(r.reason as Error)?.message ?? r.reason}` : null)).filter(Boolean);
    throw new Error(`No feeds could be loaded (${reasons.slice(0, 4).join("; ")})`);
  }
  return ok;
}

export const readFeedItems = async (res: Response): Promise<RssItem[]> => parseFeedXml(await res.text());
