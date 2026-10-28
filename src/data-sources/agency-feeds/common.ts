/**
 * Shared machinery for the agency press-release connectors (defense, energy, trade, health,
 * science, regulators, justice, EU Commission, economic releases). Each connector lists its
 * official RSS feeds and supplies a `classify` function; this module fetches the feeds,
 * applies the age window, resolves links, builds stable ids and places each record at the
 * issuer's headquarters unless the connector locates it from the headline.
 *
 * The publisher's own title is kept verbatim (only an issuer prefix may be added when the
 * title does not name the issuer).
 */
import type { EventCandidateInput, EventCategory, EventMetrics, GeoPrecision, SourceAssertion } from "@/types/events";
import { placesInText, usStateInText } from "@/lib/geo/headline-places";
import { plainText, safeUrl, type DataSourceConnector, type FetchContext, type ParseContext, type ParseResult } from "../types";
import { clip, fetchEach, hashId, makeSource, readFeedItems, type Place, type RssItem } from "../official-common";

export type { Place, RssItem };

export interface AgencyFeed {
  id: string;
  /** Publisher shown as the source, e.g. "U.S. Department of Justice". */
  name: string;
  url: string;
  /** Where the record is shown when the headline gives no better place. */
  place: Place;
  /** Factual credibility basis, e.g. "U.S. federal agency (DOJ Office of Public Affairs)". */
  basis: string;
  /** Short names that count as naming the issuer in a title (else "<name>: " is prefixed). */
  alias?: RegExp;
  /** Prefix added to titles that do not name the issuer (defaults to `name`). */
  prefix?: string;
}

export interface AgencyFeedsRaw {
  feeds: Array<{ feed: string; items: RssItem[] }>;
}

/** One feed item after the shared checks, handed to the connector's classifier. */
export interface FeedItemView<F extends AgencyFeed = AgencyFeed> {
  feed: F;
  title: string;
  link: string;
  /** ISO timestamp */
  published: string;
  description: string;
  item: RssItem;
}

export interface Located {
  lat: number;
  lon: number;
  name: string;
  country: string | null;
  precision: GeoPrecision;
  /** Sentence appended to the summary explaining the placement. */
  note?: string;
}

export interface Classified {
  type: EventCategory;
  subtype: string;
  metrics?: EventMetrics;
  /** Overrides the default placement at the feed's `place`. */
  located?: Located | null;
  /** Extra summary sentence (facts from the feed only). */
  extra?: string;
  /** Replaces the shown title (still built only from upstream text). */
  title?: string;
}

export interface AgencySpec<F extends AgencyFeed> {
  dataSourceId: string;
  feeds: readonly F[];
  maxAgeMs: number;
  /** Return null to skip the item (routine notice, out of scope). */
  classify(v: FeedItemView<F>): Classified | null;
  /** Key the externalId is derived from; defaults to the item link. */
  idKey?(v: FeedItemView<F>): string;
  assertion?: SourceAssertion;
  /** Items kept per feed per run. */
  maxItemsPerFeed?: number;
}

export async function fetchAgencyFeeds<F extends AgencyFeed>(ctx: FetchContext, feeds: readonly F[], maxItems = 80): Promise<AgencyFeedsRaw> {
  const ok = await fetchEach(ctx, feeds, readFeedItems);
  return { feeds: ok.map(({ feed, data }) => ({ feed: feed.id, items: data.slice(0, maxItems) })) };
}

/** Resolve a possibly relative feed link against the feed URL; http(s) only. */
export function resolveLink(link: string, base: string): string | null {
  try {
    return safeUrl(new URL(link.trim(), base).toString());
  } catch {
    return null;
  }
}

const utc = (iso: string) => `${iso.slice(0, 16).replace("T", " ")} UTC`;

export function parseAgencyFeeds<F extends AgencyFeed>(spec: AgencySpec<F>, raw: AgencyFeedsRaw, ctx: ParseContext): ParseResult {
  const candidates: EventCandidateInput[] = [];
  let skipped = 0;
  const seen = new Set<string>();
  for (const { feed: feedId, items } of raw.feeds ?? []) {
    const feed = spec.feeds.find((f) => f.id === feedId);
    if (!feed) continue;
    for (const it of items ?? []) {
      const title = plainText(it.title, 400);
      const link = it.link ? resolveLink(it.link, feed.url) : null;
      const t = it.published ? Date.parse(it.published.replace(/\s+/g, " ")) : NaN;
      if (!title || title.length < 5 || !link || Number.isNaN(t) || ctx.now - t > spec.maxAgeMs || t > ctx.now + 3_600_000) {
        skipped++;
        continue;
      }
      const published = new Date(t).toISOString();
      const view: FeedItemView<F> = { feed, title, link, published, description: plainText(it.description, 1500), item: it };
      const c = spec.classify(view);
      const externalId = `${feed.id}:${hashId((spec.idKey?.(view) ?? link).replace(/^http:/, "https:"))}`;
      if (!c || seen.has(externalId)) {
        skipped++;
        continue;
      }
      seen.add(externalId);
      const named = feed.alias ? feed.alias.test(title) : title.toLowerCase().includes(feed.name.toLowerCase());
      const shown = c.title ?? (named ? title : `${feed.prefix ?? feed.name}: ${title}`);
      const loc: Located = c.located ?? { lat: feed.place.lat, lon: feed.place.lon, name: feed.place.name, country: feed.place.country, precision: "city" };
      const where = c.located ? (c.located.note ?? "") : ` Shown at the issuer's headquarters (${feed.place.name}).`;
      candidates.push({
        type: c.type,
        subtype: c.subtype,
        title: clip(shown),
        summary: clip(`${feed.name} published “${title}” on ${utc(published)}.${c.extra ? ` ${c.extra}` : ""}${where}`, 1990),
        description: view.description && view.description !== title ? view.description : null,
        latitude: loc.lat,
        longitude: loc.lon,
        geoPrecision: loc.precision,
        locationName: loc.name,
        country: loc.country,
        timestamp: published,
        metrics: c.metrics ?? {},
        entities: [{ type: "ORGANIZATION", name: feed.name, code: null }],
        source: makeSource({
          dataSourceId: spec.dataSourceId,
          externalId,
          sourceName: feed.name,
          sourceUrl: link,
          title,
          publishedAt: published,
          retrievedAt: ctx.retrievedAt,
          assertion: spec.assertion,
          basis: feed.basis,
        }),
        rawData: { feed: feed.id, link, published: it.published },
      });
    }
  }
  return { candidates, skipped };
}

/**
 * A place the headline names, other than the issuer's home country: a city, else the country
 * (label point). A place introduced by "in/near/at …" wins over a bare mention.
 */
export function headlinePlace(text: string, homeCountry: string, issuer: string): Located | null {
  const places = placesInText(text);
  const place = places.find((p) => p.cued && p.country.code !== homeCountry) ?? places.find((p) => p.country.code !== homeCountry);
  if (!place) return null;
  const [lon, lat] = place.city ? [place.city.lon, place.city.lat] : place.country.label;
  const name = place.city ? `${place.city.name}, ${place.country.name}` : place.country.name;
  return { lat, lon, name, country: place.country.code, precision: place.city ? "city" : "country", note: ` Shown in ${place.country.name}, which the headline names; issued by ${issuer}.` };
}

/** A US state the headline names (state centre, region precision). */
export function headlineUsState(text: string, issuer: string): Located | null {
  const st = usStateInText(text);
  if (!st?.city) return null;
  return { lat: st.city.lat, lon: st.city.lon, name: `${st.name}, United States`, country: "US", precision: "region", note: ` Shown in ${st.name}, which the headline names (state centre); issued by ${issuer}.` };
}

/** Largest dollar amount in a text, in USD ("$49M", "$1.2 billion", "$350,000"). */
export function maxDollarAmount(text: string): number | null {
  let best: number | null = null;
  for (const m of text.matchAll(/\$\s?(\d[\d,]*(?:\.\d+)?)\s*(billion|million|thousand|bn|[BMK])?\b/gi)) {
    const n = Number(m[1].replace(/,/g, ""));
    if (!Number.isFinite(n)) continue;
    const u = (m[2] ?? "").toLowerCase();
    const v = n * (u === "billion" || u === "bn" || u === "b" ? 1e9 : u === "million" || u === "m" ? 1e6 : u === "thousand" || u === "k" ? 1e3 : 1);
    if (best === null || v > best) best = v;
  }
  return best;
}

/** Build a connector from a spec plus its descriptive fields. */
export function agencyConnector<F extends AgencyFeed>(
  spec: AgencySpec<F>,
  meta: Omit<DataSourceConnector<AgencyFeedsRaw>, "id" | "fetch" | "parse" | "mode" | "sourceType"> & { sourceType?: DataSourceConnector["sourceType"] },
): DataSourceConnector<AgencyFeedsRaw> {
  return {
    id: spec.dataSourceId,
    sourceType: "OFFICIAL_AGENCY",
    timeoutMs: 30_000,
    ...meta,
    mode: "live",
    fetch: (ctx) => fetchAgencyFeeds(ctx, spec.feeds, spec.maxItemsPerFeed),
    parse: (raw, ctx) => parseAgencyFeeds(spec, raw, ctx),
  };
}
