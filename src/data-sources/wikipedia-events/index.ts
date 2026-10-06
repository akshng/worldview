/**
 * Wikipedia "Current events" portal: a human-curated daily list of world events,
 * each citing a news source. Keyless (action=raw). Text is CC BY-SA; every event
 * links to the cited article and the portal day is named in the summary.
 */
import type { EventCandidateInput, EventCategory } from "@/types/events";
import { placesInText, seaInText, usStateInText, type HeadlinePlace } from "@/lib/geo/headline-places";
import { httpGet, safeUrl, type DataSourceConnector, type FetchContext, type ParseContext, type ParseResult } from "../types";

export interface WikiDay {
  date: string;
  wikitext: string;
}
export interface WikiRaw {
  days: WikiDay[];
}

const SECTIONS: Record<string, { type: EventCategory; subtype: string }> = {
  "armed conflicts and attacks": { type: "CONFLICT", subtype: "armed conflict" },
  "disasters and accidents": { type: "DISASTER", subtype: "disaster or accident" },
  "health and environment": { type: "HEALTH", subtype: "health" },
  "international relations": { type: "POLITICS", subtype: "international relations" },
  "law and crime": { type: "NEWS", subtype: "law and crime" },
  "politics and elections": { type: "POLITICS", subtype: "politics" },
  "business and economy": { type: "BUSINESS", subtype: "business" },
  "science and technology": { type: "SCIENCE", subtype: "science and technology" },
  "arts and culture": { type: "NEWS", subtype: "arts and culture" },
  sports: { type: "NEWS", subtype: "sports" },
};

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const portalTitle = (d: Date) => `Portal:Current_events/${d.getUTCFullYear()}_${MONTHS[d.getUTCMonth()]}_${d.getUTCDate()}`;

export async function fetchWikipediaEvents(ctx: FetchContext): Promise<WikiRaw> {
  const days: WikiDay[] = [];
  for (let i = 0; i < 3; i++) {
    const d = new Date(ctx.now - i * 86_400_000);
    try {
      const res = await httpGet(`https://en.wikipedia.org/w/index.php?title=${encodeURIComponent(portalTitle(d))}&action=raw`, ctx, { accept: "text/plain" });
      days.push({ date: d.toISOString().slice(0, 10), wikitext: await res.text() });
    } catch (err) {
      if (i > 0) throw err; // today's page may not exist yet
    }
  }
  return { days };
}

/** Wikitext → { display text, location text (link targets), citations }. */
export function cleanWikitext(line: string): { text: string; locText: string; cites: Array<{ url: string; outlet: string }> } {
  const cites: Array<{ url: string; outlet: string }> = [];
  let s = line.replace(/^\*+\s*/, "");
  s = s.replace(/\[(https?:\/\/[^\s\]]+)\s+([^\]]*)\]/g, (_m, url: string, label: string) => {
    cites.push({ url, outlet: label.replace(/['()]/g, "").trim() });
    return "";
  });
  s = s.replace(/<ref[\s\S]*?<\/ref>|<ref[^>]*\/>/g, "").replace(/\{\{[^{}]*\}\}/g, "").replace(/'{2,}/g, "");
  const text = s.replace(/\[\[(?:[^|\]]*\|)?([^\]]+)\]\]/g, "$1").replace(/\s+/g, " ").trim();
  const locText = s
    .replace(/\[\[([^|\]]+)(?:\|[^\]]+)?\]\]/g, (_m, target: string) => target.replace(/#.*$/, "").replace(/\s*\([^)]*\)/g, "").replace(/,/g, ""))
    .replace(/\s+/g, " ")
    .trim();
  return { text, locText, cites };
}

/**
 * Encyclopedic sentences name many places ("…his opponent is a Rio de Janeiro senator"),
 * so use a cued place ("in Sheraro") if any, else the first place mentioned — not the
 * most specific one as for headlines.
 */
export function placeForSentence(text: string): HeadlinePlace | null {
  const places = placesInText(text);
  const state = usStateInText(text);
  const cued = places.find((p) => p.cued) ?? (state?.cued ? state : undefined);
  const pick = cued ?? [...places, ...(state ? [state] : [])].sort((a, b) => a.index - b.index)[0];
  if (!pick) return null;
  return state && !pick.city && pick.country.code === "US" ? state : pick;
}

function hash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

export function parseWikipediaEvents(raw: WikiRaw, ctx: ParseContext): ParseResult {
  const candidates: EventCandidateInput[] = [];
  let skipped = 0;
  for (const day of raw.days ?? []) {
    let section: { type: EventCategory; subtype: string } | null = null;
    const parents: string[] = []; // location text of ancestor topic lines, by depth
    for (const line of day.wikitext.split(/\r?\n/)) {
      const head = line.match(/^'''(.+?)'''\s*$/) ?? line.match(/^;\s*(.+)$/);
      if (head) {
        section = SECTIONS[head[1].trim().toLowerCase()] ?? { type: "NEWS", subtype: "news" };
        parents.length = 0;
        continue;
      }
      const depth = line.match(/^(\*+)/)?.[1].length ?? 0;
      if (!depth || !section) continue;
      const { text, locText, cites } = cleanWikitext(line);
      parents.length = depth - 1;
      if (!cites.length) {
        parents[depth - 1] = locText; // topic heading, used as location context for its items
        continue;
      }
      const url = safeUrl(cites[0].url);
      if (!url || text.length < 20) {
        skipped++;
        continue;
      }
      const placeOnLand = placeForSentence(locText);
      // An event "in the Caribbean Sea" happened at sea, not in the country also named.
      const sea = seaInText(locText);
      const atSea = sea && (sea.cued || !placeOnLand) ? sea : null;
      const place = atSea ? null : placeOnLand ?? [...parents].reverse().map((p) => (p ? placeForSentence(p) : null)).find(Boolean) ?? null;
      if (!place && !atSea) {
        skipped++;
        continue;
      }
      const [lon, lat] = atSea ? [atSea.lon, atSea.lat] : place!.city ? [place!.city.lon, place!.city.lat] : place!.country.label;
      const ts = `${day.date}T12:00:00.000Z`;
      const outlets = [...new Set(cites.map((c) => c.outlet).filter(Boolean))];
      const key = hash(`${day.date}:${text}`);
      candidates.push({
        type: section.type,
        subtype: section.subtype,
        title: text.length > 280 ? `${text.slice(0, 279).replace(/\s+\S*$/, "")}…` : text,
        summary: `Listed on Wikipedia's Current Events portal for ${day.date}${outlets.length ? `, citing ${outlets.join(", ")}` : ""}. Date only — the time of day is not given.`,
        latitude: lat,
        longitude: lon,
        geoPrecision: atSea ? "approximate" : place!.city ? (place!.city.population === 0 ? "region" : "city") : "country",
        locationName: atSea ? atSea.name : place!.city ? `${place!.city.name}, ${place!.country.name}` : place!.country.name,
        country: atSea ? null : place!.country.code,
        timestamp: ts,
        metrics: { cited_outlets: outlets.join(", ") || null, date_only: true },
        entities: [],
        source: {
          id: `wikipedia-events:${key}`,
          dataSourceId: "wikipedia-events",
          externalId: key,
          sourceName: `Wikipedia Current Events${outlets[0] ? ` (citing ${outlets[0]})` : ""}`,
          sourceUrl: url,
          title: text.slice(0, 300),
          titleIsDerived: false,
          publishedAt: ts,
          retrievedAt: ctx.retrievedAt,
          sourceType: "COMMUNITY_DATABASE",
          assertion: "MEDIA_REPORT",
          credibility: { basis: "Volunteer-curated Wikipedia portal; each item cites a published news report" },
        },
        rawData: { date: day.date, cites },
      });
    }
  }
  return { candidates, skipped };
}

export const wikipediaEventsConnector: DataSourceConnector<WikiRaw> = {
  id: "wikipedia-events",
  name: "Wikipedia Current Events",
  description: "The human-curated daily world-events list on Wikipedia's Current Events portal (last 3 days), each item linked to the news report it cites.",
  homepage: "https://en.wikipedia.org/wiki/Portal:Current_events",
  attribution: "Wikipedia contributors — CC BY-SA 4.0; cited articles belong to their publishers",
  sourceType: "COMMUNITY_DATABASE",
  categories: ["CONFLICT", "DISASTER", "HEALTH", "POLITICS", "NEWS", "BUSINESS", "SCIENCE"],
  refreshIntervalMs: 30 * 60_000,
  mode: "live",
  fetch: fetchWikipediaEvents,
  parse: parseWikipediaEvents,
};
