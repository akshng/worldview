/**
 * International Atomic Energy Agency "Top News" RSS (keyless): press releases and news —
 * Director General statements on nuclear safety in Ukraine, review missions, plant events,
 * Fukushima ALPS water monitoring. Feature stories and multimedia are skipped.
 *
 * The feed prints dates as "26-10-28  14:21" (YY-MM-DD, Vienna local time, no zone); they are
 * converted from Europe/Vienna to UTC. Placed in the country a headline names, else at the IAEA
 * in Vienna.
 */
import type { EventCandidateInput } from "@/types/events";
import { plainText, safeUrl, type DataSourceConnector, type FetchContext, type ParseContext, type ParseResult } from "../types";
import { HQ, clip, fetchEach, hashId, makeSource, placeInTitle, readFeedItems, zonedToUtc, type RssItem } from "../official-common";

export interface IaeaRaw {
  items: RssItem[];
}

const FEED = { id: "iaea", url: "https://www.iaea.org/feeds/topnews" };
const MAX_AGE_MS = 14 * 86_400_000;
/** Nuclear-safety / plant-operations wording: these are infrastructure events, the rest science & policy. */
const SAFETY = /\b(Situation in Ukraine|nuclear (power )?plant|NPP|reactor|Zaporizhzhya|Chornobyl|Kursk|Fukushima|ALPS|safety|security|incident|event|radioactive|radiation|radiological|safeguards|enrichment|uranium|drone|shelling|power line|blackout|IRRS|OSART|INIR|SALTO)\b/i;

export async function fetchIaea(ctx: FetchContext): Promise<IaeaRaw> {
  const [ok] = await fetchEach(ctx, [FEED], readFeedItems);
  return { items: ok?.data ?? [] };
}

/** "26-10-28  14:21" (Vienna) → ISO UTC; also accepts RFC 822 dates. */
export function iaeaDate(s: string | null): string | null {
  const m = s?.trim().match(/^(\d{2})-(\d{2})-(\d{2})\s+(\d{1,2}):(\d{2})$/);
  if (m) return zonedToUtc("Europe/Vienna", 2000 + Number(m[1]), +m[2], +m[3], +m[4], +m[5]).toISOString();
  const t = s ? Date.parse(s) : NaN;
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

export function parseIaea(raw: IaeaRaw, ctx: ParseContext): ParseResult {
  const candidates: EventCandidateInput[] = [];
  let skipped = 0;
  const seen = new Set<string>();
  for (const it of raw.items ?? []) {
    const title = plainText(it.title, 400);
    const link = safeUrl(it.link?.replace(/^http:/, "https:"));
    const ts = iaeaDate(it.published);
    const age = ts ? ctx.now - Date.parse(ts) : NaN;
    // Explainers ("What is Nuclear Fuel?") are not events.
    if (!title || title.length < 8 || !link || !/\/newscenter\/(news|pressreleases)\//.test(link) || /\?$/.test(title) || Number.isNaN(age) || age > MAX_AGE_MS || age < -3_600_000) {
      skipped++;
      continue;
    }
    const externalId = hashId(link);
    if (seen.has(externalId)) {
      skipped++;
      continue;
    }
    seen.add(externalId);
    const kind = /\/pressreleases\//.test(link) ? "press release" : "news";
    const place = placeInTitle(title, ["AT"]);
    const description = plainText(it.description, 1500);
    const safety = SAFETY.test(title);
    candidates.push({
      type: safety ? "INFRASTRUCTURE" : "SCIENCE",
      subtype: safety ? "nuclear safety" : `IAEA ${kind}`,
      title: clip(/\bIAEA\b/.test(title) ? title : `IAEA: ${title}`),
      summary:
        `The International Atomic Energy Agency published “${title}” (${kind}) on ${ts!.slice(0, 16).replace("T", " ")} UTC.` +
        (place ? ` Shown in ${place.name}, which the headline names; issued in Vienna.` : " Shown at IAEA headquarters, Vienna (no country in the headline)."),
      description: description && description !== title ? description : null,
      latitude: place ? place.lat : HQ.iaea.lat,
      longitude: place ? place.lon : HQ.iaea.lon,
      geoPrecision: place ? place.precision : "city",
      locationName: place ? place.name : HQ.iaea.name,
      country: place ? place.country : HQ.iaea.country,
      timestamp: ts!,
      metrics: { kind },
      entities: [{ type: "ORGANIZATION", name: "International Atomic Energy Agency", code: "IAEA" }],
      source: makeSource({
        dataSourceId: "iaea",
        externalId,
        sourceName: "IAEA — Top News",
        sourceUrl: link,
        title,
        publishedAt: ts,
        retrievedAt: ctx.retrievedAt,
        basis: "International Atomic Energy Agency (UN-system intergovernmental agency) official RSS feed",
      }),
      rawData: { link, published: it.published },
    });
  }
  return { candidates, skipped };
}

export const iaeaConnector: DataSourceConnector<IaeaRaw> = {
  id: "iaea",
  name: "IAEA news",
  description: "IAEA press releases and news (nuclear safety in Ukraine, review missions, plant events; last 14 days), in the country the headline names.",
  homepage: "https://www.iaea.org/newscenter",
  attribution: "International Atomic Energy Agency — iaea.org; link back to each item",
  sourceType: "OFFICIAL_AGENCY",
  categories: ["INFRASTRUCTURE", "SCIENCE"],
  refreshIntervalMs: 60 * 60_000,
  mode: "live",
  fetch: fetchIaea,
  parse: parseIaea,
};
