/**
 * Small helpers shared by the institutional-feed connectors (central banks, sanctions,
 * status pages, recalls, …). Feeds are read with the news-rss XML reader; no extra dependency.
 */
import type { EventSource, SourceAssertion, SourceType } from "@/types/events";
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
  treasury: { lat: 38.8981, lon: -77.0344, name: "U.S. Treasury, Washington, DC", country: "US" },
  euCouncil: { lat: 50.8423, lon: 4.3817, name: "Council of the EU, Brussels", country: "BE" },
  ukGov: { lat: 51.5033, lon: -0.1276, name: "Whitehall, London", country: "GB" },
  unHq: { lat: 40.7489, lon: -73.968, name: "United Nations Headquarters, New York", country: "US" },
  fda: { lat: 39.0346, lon: -76.9834, name: "U.S. FDA, Silver Spring, MD", country: "US" },
  cpsc: { lat: 38.9847, lon: -77.0947, name: "U.S. CPSC, Bethesda, MD", country: "US" },
  hibp: { lat: -28.0167, lon: 153.4, name: "Have I Been Pwned, Gold Coast, Australia", country: "AU" },
} as const;
export type Place = { lat: number; lon: number; name: string; country: string };

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
