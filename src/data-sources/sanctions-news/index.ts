/**
 * EU and UK sanctions announcements: Council of the EU press releases RSS and GOV.UK
 * news search (Atom) for "sanctions", both filtered to sanctions / restrictive-measures
 * titles. Placed in the country a title names (e.g. "UK sanctions … in Sudan"), else at
 * the issuing government.
 */
import type { EventCandidateInput } from "@/types/events";
import { placesInText } from "@/lib/geo/headline-places";
import { plainText, safeUrl, type DataSourceConnector, type FetchContext, type ParseContext, type ParseResult } from "../types";
import { HQ, clip, fetchEach, hashId, makeSource, readFeedItems, type Place, type RssItem } from "../official-common";

export interface SanctionsFeed {
  id: "eu-council" | "uk-gov";
  name: string;
  url: string;
  place: Place;
  basis: string;
}

export const SANCTIONS_FEEDS: SanctionsFeed[] = [
  {
    id: "eu-council",
    name: "Council of the EU",
    url: "https://www.consilium.europa.eu/en/rss/pressreleases.ashx",
    place: HQ.euCouncil,
    basis: "Council of the European Union press releases",
  },
  {
    id: "uk-gov",
    name: "UK Government (GOV.UK)",
    url: "https://www.gov.uk/search/news-and-communications.atom?keywords=sanctions&order=updated-newest",
    place: HQ.ukGov,
    basis: "UK Government announcements on GOV.UK (OGL v3)",
  },
];

/** Titles about sanctions actions, not passing mentions. */
export const SANCTIONS_TITLE = /\b(sanction(s|ed|ing)?|restrictive measures|asset freezes?|designat(es|ed|ions?)|financial sanctions|travel bans?)\b/i;

export interface SanctionsNewsRaw {
  feeds: Array<{ feed: SanctionsFeed["id"]; items: RssItem[] }>;
}

const MAX_AGE_MS = 21 * 86_400_000;

export async function fetchSanctionsNews(ctx: FetchContext): Promise<SanctionsNewsRaw> {
  const ok = await fetchEach(ctx, SANCTIONS_FEEDS, readFeedItems);
  return { feeds: ok.map(({ feed, data }) => ({ feed: feed.id, items: data })) };
}

export function parseSanctionsNews(raw: SanctionsNewsRaw, ctx: ParseContext): ParseResult {
  const candidates: EventCandidateInput[] = [];
  let skipped = 0;
  for (const { feed: id, items } of raw.feeds ?? []) {
    const feed = SANCTIONS_FEEDS.find((f) => f.id === id);
    if (!feed) continue;
    for (const it of items) {
      const title = plainText(it.title, 400);
      const link = safeUrl(it.link);
      const t = it.published ? Date.parse(it.published) : NaN;
      if (!title || !link || !SANCTIONS_TITLE.test(title) || Number.isNaN(t) || ctx.now - t > MAX_AGE_MS || t > ctx.now + 3_600_000) {
        skipped++;
        continue;
      }
      const published = new Date(t).toISOString();
      const home = feed.place.country;
      // "UK sanctions senior commanders … in Sudan": the target country, not the issuer's.
      const target = placesInText(title).find((p) => p.country.code !== home && !(feed.id === "eu-council" && p.country.code === "BE"));
      const [lon, lat] = target ? (target.city ? [target.city.lon, target.city.lat] : target.country.label) : [feed.place.lon, feed.place.lat];
      const description = plainText(it.description, 1500);
      candidates.push({
        type: "POLITICS",
        subtype: "sanctions",
        title: clip(title),
        summary: `${feed.name} announced on ${published.slice(0, 10)}: “${title}”.${target ? ` Shown in ${target.country.name}, which the title names; issued in ${feed.place.name}.` : ""}`,
        description: description && description !== title ? description : null,
        latitude: lat,
        longitude: lon,
        geoPrecision: target ? (target.city ? "city" : "country") : "city",
        locationName: target ? (target.city ? `${target.city.name}, ${target.country.name}` : target.country.name) : feed.place.name,
        country: target ? target.country.code : home,
        timestamp: published,
        metrics: { issuer: feed.name },
        entities: [{ type: "ORGANIZATION", name: feed.name, code: null }, ...(target ? [{ type: "COUNTRY" as const, name: target.country.name, code: target.country.code }] : [])],
        source: makeSource({
          dataSourceId: "sanctions-news",
          externalId: `${feed.id}:${hashId(link)}`,
          sourceName: feed.name,
          sourceUrl: link,
          title,
          publishedAt: published,
          retrievedAt: ctx.retrievedAt,
          basis: feed.basis,
        }),
        rawData: { feed: feed.id, link, published: it.published },
      });
    }
  }
  return { candidates, skipped };
}

export const sanctionsNewsConnector: DataSourceConnector<SanctionsNewsRaw> = {
  id: "sanctions-news",
  name: "EU & UK sanctions",
  description: "Sanctions and restrictive-measures announcements from the Council of the EU and the UK Government (last 21 days), placed in the targeted country when the title names one.",
  homepage: "https://www.consilium.europa.eu/en/policies/sanctions-against-russia/",
  attribution: "Council of the European Union (reuse with acknowledgement); GOV.UK content under the Open Government Licence v3.0",
  sourceType: "OFFICIAL_AGENCY",
  categories: ["POLITICS"],
  refreshIntervalMs: 30 * 60_000,
  mode: "live",
  fetch: fetchSanctionsNews,
  parse: parseSanctionsNews,
};
