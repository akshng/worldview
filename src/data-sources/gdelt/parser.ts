/**
 * GDELT → events. GDELT rows are machine-coded from news articles; we:
 *  1. keep root events with city/ADM1-level geocoding (country centroids are dropped),
 *  2. keep categories with signal (conflict, protest, coercion…) above article thresholds,
 *  3. collapse rows per (article, place, category) into one candidate,
 *  4. let the deduplication engine merge articles describing the same event.
 * Titles are generated from the CAMEO code + place; we never invent headlines.
 */
import type { EventCandidateInput } from "@/types/events";
import { safeUrl, type ParseContext, type ParseResult } from "../types";
import { cameoLabel, cameoRule, refineCategory } from "./cameo";
import type { GdeltEventRow, GdeltRaw } from "./types";

const MAX_AGE_DAYS = 3;
/** Site sections whose violent vocabulary is figurative ("attack", "clash", "fight"). */
const NON_NEWS_SECTION = /\/(sports?|sport-news|nfl|nba|mlb|nhl|soccer|football|cricket|entertainment|celebrity|lifestyle|recipes?|horoscopes?|gaming|movies|tv|music)\//i;
const MAX_PER_RUN = 1500;

function stampToIso(s: string): string | null {
  if (!/^\d{14}$/.test(s)) return null;
  return new Date(Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +s.slice(8, 10), +s.slice(10, 12), +s.slice(12, 14))).toISOString();
}

function sqlDateMs(s: string): number {
  return Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8));
}

/** Best-effort readable title from a URL slug. Marked as derived in the UI. */
export function titleFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const segs = u.pathname.split("/").filter(Boolean).reverse();
    for (const seg of segs) {
      const clean = decodeURIComponent(seg).replace(/\.(html?|php|aspx?|cms|ece|amp)$/i, "");
      // Keep short numbers ("13-year-old"), drop long numeric ids and hash-like tokens.
      const words = clean.split(/[-_+]+/).filter((w) => w && (/^\d{1,4}$/.test(w) || !/\d/.test(w)));
      if (words.length >= 4 && words.filter((w) => w.length >= 3).length >= 3) {
        const s = words.join(" ");
        return (s.charAt(0).toUpperCase() + s.slice(1)).slice(0, 160);
      }
    }
  } catch {}
  return null;
}

function hash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

const cleanActor = (s: string) => s.trim().toLowerCase().replace(/\b\w/g, (m) => m.toUpperCase());

interface Group {
  row: GdeltEventRow;
  priority: number;
  category: ReturnType<typeof refineCategory>;
  rows: number;
  actors: Set<string>;
}

export function parseGdelt(raw: GdeltRaw, ctx: ParseContext): ParseResult {
  let skipped = 0;
  const groups = new Map<string, Group>();
  const minDate = ctx.now - MAX_AGE_DAYS * 86_400_000;

  for (const file of raw.files) {
    for (const r of file.rows) {
      const base = cameoRule(r.eventRootCode, r.eventBaseCode);
      const rule = base && refineCategory(base, r.eventRootCode, [r.actor1Code, r.actor2Code, r.actor1Type, r.actor2Type]);
      const url = safeUrl(r.sourceUrl);
      if (
        !rule ||
        !url ||
        !r.isRootEvent ||
        ![3, 4, 5].includes(r.geoType) ||
        !Number.isFinite(r.lat) ||
        !Number.isFinite(r.lon) ||
        (r.lat === 0 && r.lon === 0) ||
        !(r.numArticles >= rule.minArticles) ||
        // Single-article, single-source violent codes are the noisiest part of GDELT.
        (rule.category === "CONFLICT" && r.numSources < 2 && r.numArticles < 3) ||
        sqlDateMs(r.sqlDate) < minDate ||
        NON_NEWS_SECTION.test(new URL(url).pathname) ||
        /^(sports?|espn)\./i.test(new URL(url).hostname)
      ) {
        skipped++;
        continue;
      }
      // One event per article: articles usually describe one main event, and
      // GDELT often geocodes the same story to several places.
      const key = url;
      const g = groups.get(key);
      const priority = rule.priority * 100 + Math.min(Math.abs(Math.min(r.goldstein, 0)), 10) * 5 + Math.min(r.numArticles, 50);
      if (!g) {
        groups.set(key, { row: r, priority, category: rule, rows: 1, actors: new Set([r.actor1Name, r.actor2Name].filter(Boolean).map(cleanActor)) });
      } else {
        g.rows++;
        [r.actor1Name, r.actor2Name].filter(Boolean).forEach((a) => g.actors.add(cleanActor(a)));
        if (priority > g.priority) {
          g.row = r;
          g.priority = priority;
          g.category = rule;
        }
        skipped++;
      }
    }
  }

  const ranked = [...groups.values()].sort((a, b) => b.priority - a.priority);
  skipped += Math.max(0, ranked.length - MAX_PER_RUN);

  const candidates: EventCandidateInput[] = ranked.slice(0, MAX_PER_RUN).map((g) => {
    const r = g.row;
    const url = safeUrl(r.sourceUrl)!;
    const host = new URL(url).hostname.replace(/^www\./, "");
    const label = cameoLabel(r.eventBaseCode, r.eventRootCode);
    const place = r.geoName.trim();
    const reportedAt = stampToIso(r.dateAdded) ?? ctx.retrievedAt;
    const actors = [...g.actors].slice(0, 4);
    const derivedTitle = titleFromUrl(url);
    const summary =
      `Machine-coded event from news coverage (GDELT): ${label.toLowerCase()} (CAMEO ${r.eventCode}) located in ${place}` +
      `${actors.length ? `, involving ${actors.join(", ")}` : ""}. ` +
      `Coded from a ${host} article first seen ${reportedAt.replace("T", " ").slice(0, 16)} UTC` +
      `${derivedTitle ? " (headline derived from the article URL)" : ""}. ` +
      `Automated coding can misclassify events or locations — consult the source article.`;
    return {
      type: g.category.category,
      subtype: g.category.subtype ?? label.toLowerCase(),
      // The article headline describes the story more faithfully than the CAMEO label,
      // which stays available as the subtype. Fall back to "label — place".
      title: derivedTitle ?? `${label} — ${place}`,
      summary,
      latitude: r.lat,
      longitude: r.lon,
      geoPrecision: r.geoType === 5 ? "region" : "city",
      locationName: place,
      country: null, // GDELT uses FIPS codes; the pipeline reverse-geocodes to ISO.
      city: r.geoType === 3 || r.geoType === 4 ? place.split(",")[0] : null,
      timestamp: reportedAt,
      metrics: {
        cameo_code: r.eventCode,
        goldstein: r.goldstein,
        num_articles: r.numArticles,
        num_sources: r.numSources,
        num_mentions: r.numMentions,
        avg_tone: Math.round(r.avgTone * 10) / 10,
      },
      entities: actors.map((name) => ({ type: "ACTOR" as const, name, code: null })),
      source: {
        id: `gdelt:${hash(url)}`,
        dataSourceId: "gdelt",
        externalId: hash(url),
        sourceName: host,
        sourceUrl: url,
        title: derivedTitle,
        titleIsDerived: derivedTitle !== null,
        publishedAt: reportedAt,
        retrievedAt: ctx.retrievedAt,
        sourceType: "NEWS_MEDIA",
        assertion: "MEDIA_REPORT",
        credibility: null,
      },
      rawData: { globalEventId: r.globalEventId, eventCode: r.eventCode, actor1: r.actor1Name, actor2: r.actor2Name, geo: r.geoName, rowsCollapsed: g.rows },
    };
  });

  return { candidates, skipped };
}
