import type { EventCandidateInput, EventCategory } from "@/types/events";
import { demonymInText, homePlaceInText, placesInText, usStateInText, type HeadlinePlace } from "@/lib/geo/headline-places";
import { THEME_RULES } from "../gdelt-gkg/parser";
import { ACCIDENT, conflictSignal, LABOUR_STRIKE, withoutFigurativeDisaster, withoutFigurativeProtest } from "../news-classify";
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
const PROTEST_WORDS = /\b(protests?|protest(?:ed|ing)|protesters?|protestors?|demonstrators?|demonstrations?|riots?|rioters?|rioting|unrest|crackdown|sit-ins?|walkouts?|marchers|take to the streets)\b|\b(?:thousands|hundreds|tens of thousands) (?:march|rally|rallied|gather)\b|\bmarch(?:es|ed)? (?:against|in protest)\b/i;

/** "Russian gold floods Hong Kong", "a storm of selling": hazard words used about markets and trade. */
const FIGURATIVE = /\b(gold|bullion|oil|stocks?|shares|prices?|markets?|trade|tariffs?|sanctions|investors?|money|cash|imports?|exports?|bitcoin|crypto|bonds?|selling|buying)\b/i;

export function classifyHeadline(title: string): { type: EventCategory; subtype: string } {
  if (HAZARD.test(withoutFigurativeDisaster(title)) && !FIGURATIVE.test(title)) return { type: "DISASTER", subtype: "disaster news" };
  if (LABOUR_STRIKE.test(title)) return { type: "PROTEST", subtype: "strike" };
  const signal = conflictSignal(title);
  // A protest headline is a protest unless it reports terrorism ("police clash with protesters").
  if (PROTEST_WORDS.test(withoutFigurativeProtest(title)) && !(signal.kind === "conflict" && signal.subtype === "terrorism")) {
    return { type: "PROTEST", subtype: "protest" };
  }
  if (signal.kind === "conflict" && signal.strength === "strong") return { type: "CONFLICT", subtype: signal.subtype };
  if (ACCIDENT.test(title)) return { type: "DISASTER", subtype: "accident" };
  if (signal.kind === "conflict") return { type: "CONFLICT", subtype: signal.subtype };
  if (signal.kind === "crime") return { type: "NEWS", subtype: "crime / public safety" };
  for (const r of THEME_RULES) {
    // Conflict and protest are decided by the context rules above.
    if (r.category === "CONFLICT" || r.category === "PROTEST") continue;
    if (r.title.test(title)) return { type: r.category, subtype: r.subtype };
  }
  return { type: "NEWS", subtype: "news" };
}

/**
 * Where a headline is about: a cued place ("in Gaza"), else the most specific place it
 * names (city, then US state, then country). The summary is used only when the headline
 * names no place at all, and then only a cued one.
 */
export function placeFor(title: string, description: string, home?: string): { place: HeadlinePlace; fromTitle: boolean } | null {
  const inTitle = placesInText(title);
  const state = usStateInText(title);
  // For an outlet with a home country: a town or province of that country it names ("Punjab" in Dawn).
  const local = home ? homePlaceInText(title, home) : null;
  const cued = inTitle.find((p) => p.cued) ?? (state?.cued ? state : undefined) ?? (local?.cued ? local : undefined);
  const t = cued ?? inTitle.find((p) => p.city) ?? local ?? state ?? inTitle[0];
  // A US state beats a bare "US"/"America" mention.
  if (t && !(state && !t.city && t.country.code === "US")) return { place: t, fromTitle: true };
  if (state) return { place: state, fromTitle: true };
  // "Bulgarian PM says …": the one nationality named, when no place is.
  const nat = demonymInText(title);
  if (nat) return { place: nat, fromTitle: true };
  const homeInDesc = home ? homePlaceInText(description, home) : null;
  const d = placesInText(description).find((p) => p.cued) ?? (homeInDesc?.cued ? homeInDesc : undefined);
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
      const located = placeFor(title, description, outlet.home);
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
