/**
 * UN Meetings Coverage and Press Releases (press.un.org RSS, keyless): Security Council
 * meetings and statements, General Assembly, Secretary-General. Placed in the country a
 * headline names, else at UN Headquarters in New York.
 */
import type { EventCandidateInput } from "@/types/events";
import { placesInText } from "@/lib/geo/headline-places";
import { plainText, safeUrl, type DataSourceConnector, type FetchContext, type ParseContext, type ParseResult } from "../types";
import { HQ, clip, fetchEach, hashId, makeSource, readFeedItems, type RssItem } from "../official-common";

export interface UnPressRaw {
  items: RssItem[];
}

const FEED = { id: "un-press", url: "https://press.un.org/en/rss.xml" };
const MAX_AGE_MS = 7 * 86_400_000;
/** Routine notices that are not events. */
const ROUTINE = /^(Daily Press Briefing|Note to Correspondents|Media Advisory|Programme of Meetings|Highlights of the Noon Briefing)/i;

export async function fetchUnPress(ctx: FetchContext): Promise<UnPressRaw> {
  const [ok] = await fetchEach(ctx, [FEED], readFeedItems);
  return { items: ok?.data ?? [] };
}

export function unBody(title: string, link: string): string {
  if (/^Security Council\b|\bSecurity Council\b/i.test(title) || /\/sc\d+/i.test(link)) return "Security Council";
  if (/\bSecretary-General\b/i.test(title) || /\/sg(sm|2)?\d+/i.test(link)) return "Secretary-General";
  if (/\/ga[a-z]*\d+/i.test(link) || /\bGeneral Assembly\b|\bCommittee\b/i.test(title)) return "General Assembly";
  return "United Nations";
}

export function parseUnPress(raw: UnPressRaw, ctx: ParseContext): ParseResult {
  const candidates: EventCandidateInput[] = [];
  let skipped = 0;
  const seen = new Set<string>();
  for (const it of raw.items ?? []) {
    const title = plainText(it.title, 400);
    const link = safeUrl(it.link);
    const t = it.published ? Date.parse(it.published) : NaN;
    if (!title || title.length < 10 || !link || !/\.doc\.htm$/i.test(link) || ROUTINE.test(title) || Number.isNaN(t) || ctx.now - t > MAX_AGE_MS || seen.has(link)) {
      skipped++;
      continue;
    }
    seen.add(link);
    const ts = new Date(t).toISOString();
    const body = unBody(title, link);
    // UN Headquarters is in the US, so a US mention ("United States embargo of Cuba") ranks last.
    const places = placesInText(title);
    const place = places.find((p) => p.cued && p.country.code !== "US") ?? places.find((p) => p.country.code !== "US") ?? places.find((p) => p.cued);
    const [lon, lat] = place ? (place.city ? [place.city.lon, place.city.lat] : place.country.label) : [HQ.unHq.lon, HQ.unHq.lat];
    candidates.push({
      type: "POLITICS",
      subtype: body === "Security Council" ? "UN Security Council" : body === "Secretary-General" ? "UN Secretary-General" : "UN press release",
      title: clip(title),
      summary: `UN Meetings Coverage and Press Releases (${body}), ${ts.slice(0, 16).replace("T", " ")} UTC: “${title}”.${place ? ` Shown in ${place.country.name}, which the headline names; issued at UN Headquarters, New York.` : ""}`,
      description: plainText(it.description, 1500) || null,
      latitude: lat,
      longitude: lon,
      geoPrecision: place ? (place.city ? "city" : "country") : "city",
      locationName: place ? (place.city ? `${place.city.name}, ${place.country.name}` : place.country.name) : HQ.unHq.name,
      country: place ? place.country.code : "US",
      timestamp: ts,
      metrics: { body },
      entities: [{ type: "ORGANIZATION", name: body === "United Nations" ? "United Nations" : `UN ${body}`, code: "UN" }],
      source: makeSource({
        dataSourceId: "un-press",
        externalId: hashId(link),
        sourceName: "UN Meetings Coverage and Press Releases",
        sourceUrl: link,
        title,
        publishedAt: ts,
        retrievedAt: ctx.retrievedAt,
        basis: "United Nations Department of Global Communications",
      }),
      rawData: { link, published: it.published },
    });
  }
  return { candidates, skipped };
}

export const unPressConnector: DataSourceConnector<UnPressRaw> = {
  id: "un-press",
  name: "UN press releases",
  description: "UN Security Council, General Assembly and Secretary-General meetings coverage and press releases (last 7 days).",
  homepage: "https://press.un.org/en",
  attribution: "United Nations — press.un.org; UN material may be reproduced with attribution",
  sourceType: "OFFICIAL_AGENCY",
  categories: ["POLITICS"],
  refreshIntervalMs: 30 * 60_000,
  mode: "live",
  fetch: fetchUnPress,
  parse: parseUnPress,
};
