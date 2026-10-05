import type { EventCandidateInput, EventCategory } from "@/types/events";
import { placesInText, usStateInText, type HeadlinePlace } from "@/lib/geo/headline-places";
import { THEME_RULES } from "../gdelt-gkg/parser";
import { plainText, safeUrl, type ParseContext, type ParseResult } from "../types";
import type { NewsRssRaw } from "./types";

const MAX_AGE_MS = 48 * 3_600_000;

/**
 * Natural hazards are covered by official sources; news headlines about them are
 * filed as general disaster news so they never duplicate a measured earthquake etc.
 */
const HAZARD = /\b(earthquakes?|quakes?|tsunamis?|floods?|flooding|hurricanes?|typhoons?|cyclones?|storms?|tornado(?:es)?|wildfires?|bushfires?|volcan\w*|eruptions?|landslides?|droughts?|heatwaves?|heat (?:waves?|warnings?|alerts?)|blizzards?|avalanches?)\b/i;

/**
 * Without GDELT's theme tags the headline alone decides, so PROTEST needs an unambiguous
 * word ("rally" and "march" are as often campaigns or markets).
 */
const PROTEST_WORDS = /\b(protests?|protesters?|demonstrat\w+|riots?|rioters?|unrest|crackdown|sit-ins?|walkouts?|strikers?)\b/i;

/** "Russian gold floods Hong Kong", "a storm of selling": hazard words used about markets and trade. */
const FIGURATIVE = /\b(gold|bullion|oil|stocks?|shares|prices?|markets?|trade|tariffs?|sanctions|investors?|money|cash|imports?|exports?|bitcoin|crypto|bonds?|selling|buying)\b/i;

export function classifyHeadline(title: string): { type: EventCategory; subtype: string } {
  if (HAZARD.test(title) && !FIGURATIVE.test(title)) return { type: "DISASTER", subtype: "disaster news" };
  for (const r of THEME_RULES) {
    if (!r.title.test(title)) continue;
    if (r.category === "PROTEST" && !PROTEST_WORDS.test(title)) continue;
    return { type: r.category, subtype: r.subtype };
  }
  return { type: "NEWS", subtype: "news" };
}

/**
 * Where a headline is about: a cued place ("in Gaza"), else the most specific place it
 * names (city, then US state, then country). The summary is used only when the headline
 * names no place at all, and then only a cued one.
 */
export function placeFor(title: string, description: string): { place: HeadlinePlace; fromTitle: boolean } | null {
  const inTitle = placesInText(title);
  const state = usStateInText(title);
  const cued = inTitle.find((p) => p.cued) ?? (state?.cued ? state : undefined);
  const t = cued ?? inTitle.find((p) => p.city) ?? state ?? inTitle[0];
  // A US state beats a bare "US"/"America" mention.
  if (t && !(state && !t.city && t.country.code === "US")) return { place: t, fromTitle: true };
  if (state) return { place: state, fromTitle: true };
  const d = placesInText(description).find((p) => p.cued);
  return d ? { place: d, fromTitle: false } : null;
}

function hash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

export function parseNewsRss(raw: NewsRssRaw, ctx: ParseContext): ParseResult {
  const candidates: EventCandidateInput[] = [];
  let skipped = 0;
  const seenLinks = new Set<string>();
  for (const { outlet, items } of raw.feeds ?? []) {
    for (const it of items) {
      const link = safeUrl(it.link);
      const published = it.published ? new Date(it.published) : null;
      const title = plainText(it.title, 300);
      if (!link || !published || Number.isNaN(published.getTime()) || title.length < 12 || seenLinks.has(link)) {
        skipped++;
        continue;
      }
      if (ctx.now - published.getTime() > MAX_AGE_MS || published.getTime() > ctx.now + 3_600_000) {
        skipped++;
        continue;
      }
      const description = plainText(it.description, 300);
      const located = placeFor(title, description);
      if (!located) {
        skipped++; // no place we can name — don't guess
        continue;
      }
      seenLinks.add(link);
      const { place } = located;
      const [lon, lat] = place.city ? [place.city.lon, place.city.lat] : place.country.label;
      const { type, subtype } = classifyHeadline(title);
      candidates.push({
        type,
        subtype,
        title,
        summary: `${outlet.name} reported on ${published.toISOString().slice(0, 16).replace("T", " ")} UTC: “${title}”.`,
        description: description || null,
        latitude: lat,
        longitude: lon,
        geoPrecision: place.city ? (place.city.population === 0 ? "region" : "city") : "country",
        locationName: place.city ? `${place.city.name}, ${place.country.name}` : place.country.name,
        country: place.country.code,
        timestamp: published.toISOString(),
        metrics: { outlet: outlet.name, located_from: located.fromTitle ? "headline" : "summary" },
        entities: [{ type: "ORGANIZATION", name: outlet.name, code: null }],
        source: {
          id: `news-rss:${outlet.id}:${hash(link)}`,
          dataSourceId: "news-rss",
          externalId: `${outlet.id}:${hash(link)}`,
          sourceName: outlet.name,
          sourceUrl: link,
          title,
          titleIsDerived: false,
          publishedAt: published.toISOString(),
          retrievedAt: ctx.retrievedAt,
          sourceType: "NEWS_MEDIA",
          assertion: "MEDIA_REPORT",
          credibility: { basis: `${outlet.name} — established news organisation (RSS feed)` },
        },
        rawData: { outlet: outlet.id, link, published: it.published },
      });
    }
  }
  return { candidates, skipped };
}
