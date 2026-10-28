/**
 * European Centre for Disease Prevention and Control (ECDC) official RSS feeds (keyless):
 * news, epidemiological updates and risk / threat assessments. Placed in the country a
 * headline names (other than ECDC's own Sweden), else at ECDC in Solna.
 */
import type { EventCandidateInput } from "@/types/events";
import { plainText, safeUrl, type DataSourceConnector, type FetchContext, type ParseContext, type ParseResult } from "../types";
import { HQ, clip, fetchEach, hashId, makeSource, placeInTitle, readFeedItems, type RssItem } from "../official-common";

export const ECDC_FEEDS = [
  { id: "risk-assessment", label: "risk assessment", url: "https://www.ecdc.europa.eu/en/taxonomy/term/1295/feed" },
  { id: "epi-update", label: "epidemiological update", url: "https://www.ecdc.europa.eu/en/taxonomy/term/1310/feed" },
  { id: "news", label: "ECDC news", url: "https://www.ecdc.europa.eu/en/taxonomy/term/1307/feed" },
] as const;
type FeedId = (typeof ECDC_FEEDS)[number]["id"];

export interface EcdcRaw {
  feeds: Array<{ feed: FeedId; items: RssItem[] }>;
}

const MAX_AGE_MS = 14 * 86_400_000;
/** Corporate items that are not public-health events. */
const CORPORATE = /\b(Management Board|Advisory Forum|vacanc|tender|procurement|webinar|call for|award|annual report|work programme|single programming document)\b/i;

export async function fetchEcdc(ctx: FetchContext): Promise<EcdcRaw> {
  const ok = await fetchEach(ctx, ECDC_FEEDS, readFeedItems);
  return { feeds: ok.map(({ feed, data }) => ({ feed: feed.id, items: data.slice(0, 40) })) };
}

export function parseEcdc(raw: EcdcRaw, ctx: ParseContext): ParseResult {
  const candidates: EventCandidateInput[] = [];
  let skipped = 0;
  const seen = new Set<string>();
  // Feeds are read in priority order: an item in both "risk assessment" and "news" keeps the first label.
  const order = (id: FeedId) => ECDC_FEEDS.findIndex((f) => f.id === id);
  for (const { feed, items } of [...(raw.feeds ?? [])].sort((a, b) => order(a.feed) - order(b.feed))) {
    const label = ECDC_FEEDS.find((f) => f.id === feed)?.label ?? "ECDC publication";
    for (const it of items) {
      const title = plainText(it.title, 400);
      const link = safeUrl(it.link);
      const t = it.published ? Date.parse(it.published) : NaN;
      if (!title || title.length < 8 || !link || CORPORATE.test(title) || Number.isNaN(t) || ctx.now - t > MAX_AGE_MS || t > ctx.now + 3_600_000) {
        skipped++;
        continue;
      }
      const externalId = hashId(link.replace(/^http:/, "https:"));
      if (seen.has(externalId)) {
        skipped++;
        continue;
      }
      seen.add(externalId);
      const ts = new Date(t).toISOString();
      const place = placeInTitle(title, ["SE"]);
      const description = plainText(it.description, 1500);
      candidates.push({
        type: "HEALTH",
        subtype: label,
        title: clip(/\bECDC\b/.test(title) ? title : feed === "news" ? `ECDC: ${title}` : `ECDC ${label}: ${title}`),
        summary:
          `The European Centre for Disease Prevention and Control published “${title}” (${label}) on ${ts.slice(0, 10)}.` +
          (place ? ` Shown in ${place.name}, which the title names; issued by ECDC in Solna, Sweden.` : " Shown at ECDC headquarters (no country in the title)."),
        description: description && description !== title ? description : null,
        latitude: place ? place.lat : HQ.ecdc.lat,
        longitude: place ? place.lon : HQ.ecdc.lon,
        geoPrecision: place ? place.precision : "city",
        locationName: place ? place.name : HQ.ecdc.name,
        country: place ? place.country : HQ.ecdc.country,
        timestamp: ts,
        metrics: { publication: label },
        entities: [{ type: "ORGANIZATION", name: "European Centre for Disease Prevention and Control", code: "ECDC" }],
        source: makeSource({
          dataSourceId: "ecdc",
          externalId,
          sourceName: `ECDC — ${label}`,
          sourceUrl: link,
          title,
          publishedAt: ts,
          retrievedAt: ctx.retrievedAt,
          basis: "European Centre for Disease Prevention and Control (EU agency) official RSS feed",
        }),
        rawData: { feed, link, published: it.published },
      });
    }
  }
  return { candidates, skipped };
}

export const ecdcConnector: DataSourceConnector<EcdcRaw> = {
  id: "ecdc",
  name: "ECDC disease threats",
  description: "ECDC risk and threat assessments, epidemiological updates and news (last 14 days), in the country the title names.",
  homepage: "https://www.ecdc.europa.eu/en/threats-and-outbreaks",
  attribution: "European Centre for Disease Prevention and Control — reuse authorised with acknowledgement of the source",
  sourceType: "OFFICIAL_AGENCY",
  categories: ["HEALTH"],
  refreshIntervalMs: 60 * 60_000,
  mode: "live",
  fetch: fetchEcdc,
  parse: parseEcdc,
};
