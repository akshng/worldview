/**
 * GKG articles → news events with real headlines.
 *
 *  1. Keep articles with a usable title and at least one high-signal theme.
 *  2. Locate each article where its headline and its geocoded mentions agree
 *     (a mentioned city/state/country named in the headline); otherwise use a
 *     place the headline names with a locative cue; otherwise drop it.
 *  3. Cluster articles within the update by title similarity; multi-outlet
 *     stories rank first. Cap the number of candidates per run.
 *  Cross-run merging is done by the pipeline's deduplication.
 */
import type { EventCandidateInput, EventCategory } from "@/types/events";
import { placesInText } from "@/lib/geo/headline-places";
import { headlineSimilarity, tokenize } from "@/lib/deduplication/similarity";
import { safeUrl, type ParseContext, type ParseResult } from "../types";
import { conflictSignal, withoutFigurative, withoutFigurativeProtest } from "../news-classify";
import type { GkgArticle, GkgRaw } from "./types";

const MAX_PER_RUN = 150;

interface ThemeRule {
  category: EventCategory;
  subtype: string;
  weight: number;
  match: (t: string) => boolean;
  /** Headline evidence required: GKG tags themes mentioned anywhere in an article. */
  title: RegExp;
}

const has = (...names: string[]) => (t: string) => names.includes(t);
const starts = (...prefixes: string[]) => (t: string) => prefixes.some((p) => t.startsWith(p));

/** Ordered by priority: the first rule any theme matches decides the category. */
export const THEME_RULES: ThemeRule[] = [
  { category: "CONFLICT", subtype: "armed conflict", weight: 0.9, match: has("ARMEDCONFLICT", "REBELLION", "REBELS", "SEIGE", "SUICIDE_ATTACK", "CEASEFIRE", "MILITARY"), title: /\b(attacks?|strikes?|airstrikes?|kill(?:s|ed|ing)?|troops|military|army|militants?|rebels?|war|shelling|missiles?|drones?|clash(?:es)?|ceasefire|offensive|soldiers?|insurgents?|bomb(?:s|ing)?|gunmen|battle|frontline|artillery|invasion)\b/i },
  { category: "CONFLICT", subtype: "terrorism", weight: 0.9, match: has("TERROR", "ASSASSINATION", "EXTREMISM"), title: /\b(terror\w*|bomb\w*|suicide|jihad\w*|extremists?|assassinat\w*|militants?)\b/i },
  { category: "CONFLICT", subtype: "military posture", weight: 0.6, match: has("ACT_FORCEPOSTURE", "BLOCKADE", "MIL_SELF_IDENTIFIED_ARMS_DEAL", "MILITARY_COOPERATION"), title: /\b(military|navy|naval|troops|exercises?|drills?|deploy\w*|warships?|arms|weapons|defen[cs]e|missiles?)\b/i },
  { category: "AVIATION", subtype: "aviation incident", weight: 0.8, match: has("AVIATION_INCIDENT"), title: /\b(plane|flights?|airlines?|aircraft|airport|jet|pilots?|co-?pilot|crash\w*|aviation|helicopter|emergency landing)\b/i },
  { category: "MARITIME", subtype: "maritime incident", weight: 0.75, match: has("MARITIME_INCIDENT", "MARITIME_PIRACY"), title: /\b(ships?|vessels?|tankers?|cargo|ports?|navy|coast ?guard|pira\w+|maritime|shipping|ferry|boats?|strait|canal|sinks?|sank|capsiz\w+)\b/i },
  { category: "TECHNOLOGY", subtype: "cyber attack", weight: 0.75, match: has("CYBER_ATTACK"), title: /\b(cyber\w*|hack\w*|ransomware|breach|malware|ddos|data leak)\b/i },
  { category: "INFRASTRUCTURE", subtype: "power outage", weight: 0.7, match: has("POWER_OUTAGE"), title: /\b(power|blackouts?|outages?|electricity|grid)\b/i },
  { category: "HEALTH", subtype: "disease", weight: 0.7, match: starts("TAX_DISEASE", "HEALTH_PANDEMIC", "EPIDEMIC"), title: /\b(outbreaks?|virus\w*|disease|infections?|epidemic|pandemic|cholera|ebola|measles|dengue|mpox|flu|influenza|plague|vaccin\w*|covid|polio|malaria|anthrax|tuberculosis)\b/i },
  { category: "PROTEST", subtype: "protest", weight: 0.7, match: has("PROTEST", "VIOLENT_UNREST", "UNREST_CRACKDOWN"), title: /\b(protests?|protesters?|demonstrat\w+|rall(?:y|ies)|marche?s?|riots?|unrest|crackdown|sit-in)\b/i },
  { category: "PROTEST", subtype: "strike", weight: 0.55, match: has("STRIKE"), title: /\b(strikes?|walkouts?|stoppage)\b/i },
  { category: "POLITICS", subtype: "election", weight: 0.65, match: has("ELECTION", "ELECTION_FRAUD"), title: /\b(elections?|midterms?|vot(?:e|es|ing|ers)|ballots?|polls?|candidates?|campaign|referendum|elected|runoff)\b/i },
  { category: "POLITICS", subtype: "sanctions", weight: 0.65, match: has("SANCTIONS"), title: /\b(sanctions?|embargo|tariffs?|export controls?)\b/i },
  { category: "POLITICS", subtype: "government", weight: 0.5, match: has("LEGISLATION", "VETO", "CONSTITUTIONAL", "TAKE_OFFICE", "RESIGNATION", "NEGOTIATIONS", "IMPEACHMENT"), title: /\b(parliament|congress|senate|ministers?|president|prime minister|government|bill|law|cabinet|resign\w*|impeach\w*|supreme court|chancellor|premier|governor|veto|treaty|talks|summit|coalition)\b/i },
  { category: "MARKETS", subtype: "markets", weight: 0.6, match: (t) => ["ECON_STOCKMARKET", "ECON_INFLATION", "ECON_OILPRICE", "ECON_BITCOIN", "ECON_INTEREST_RATES", "ECON_CENTRALBANK", "FUELPRICES"].includes(t) || t.startsWith("ECON_WORLDCURRENCIES"), title: /\b(stocks?|shares|markets?|index|indices|inflation|rates?|yields?|bonds?|oil|crude|gold|bitcoin|crypto\w*|currenc(?:y|ies)|dollar|euro|yen|rupee|fed|central bank|nasdaq|dow|s&p)\b/i },
  { category: "BUSINESS", subtype: "business", weight: 0.5, match: has("ECON_BANKRUPTCY", "ECON_EARNINGSREPORT", "ECON_MOU", "ECON_UNIONS", "UNEMPLOYMENT", "ECON_IPO"), title: /\b(compan(?:y|ies)|firms?|earnings|profits?|revenue|bankrupt\w*|mergers?|acquisitions?|acquires?|deal|ipo|layoffs?|job cuts|ceo|investment|startups?|sales)\b/i },
  { category: "TECHNOLOGY", subtype: "technology", weight: 0.45, match: starts("TECH_"), title: /\b(ai|artificial intelligence|chips?|semiconductors?|software|tech|technology|robots?|smartphones?|internet|google|apple|microsoft|nvidia|openai|amazon|tesla|spacex|quantum)\b/i },
  { category: "SCIENCE", subtype: "science", weight: 0.45, match: has("SCIENCE"), title: /\b(scien\w+|research(?:ers)?|study|discover\w*|nasa|telescope|species|fossils?|astronom\w+|physic\w*|genom\w*)\b/i },
];

/** Natural-hazard coverage comes from official sources; news about them is skipped here. */
const SKIP = (t: string) => t.startsWith("NATURAL_DISASTER");

/** Killings and shootings without armed-conflict actors (see news-classify.ts). */
export const CRIME_RULE: ThemeRule = { category: "NEWS", subtype: "crime / public safety", weight: 0.4, match: () => false, title: /./ };

export function classifyThemes(themes: string[], title: string): ThemeRule | null {
  if (themes.some(SKIP)) return null;
  let signal: ReturnType<typeof conflictSignal> | null = null;
  for (const r of THEME_RULES) {
    if (!themes.some(r.match)) continue;
    if (r.category === "CONFLICT") {
      // Headline evidence after figurative uses are removed, then the context rules decide.
      if (!r.title.test(withoutFigurative(title))) continue;
      signal ??= conflictSignal(title);
      if (signal.kind === "crime") return CRIME_RULE;
      if (signal.kind !== "conflict") continue;
      return r;
    }
    if (r.category === "PROTEST" && !r.title.test(withoutFigurativeProtest(title))) continue;
    if (r.title.test(title)) return r;
  }
  return null;
}

const ENTITY: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”", mdash: "—", ndash: "–", hellip: "…", laquo: "«", raquo: "»" };
export function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITY[n.toLowerCase()] ?? m);
}

/** Real headline: decode, drop " | Site", " - Site", " « Site" suffixes. */
export function cleanTitle(raw: string | null, source: string): string | null {
  if (!raw) return null;
  let t = decodeEntities(raw).replace(/\s+/g, " ").trim();
  const site = source.replace(/^www\./, "").split(".")[0].toLowerCase();
  const parts = t.split(/\s+(?:\||–|-|—|«|»|::)\s+/);
  if (parts.length > 1) {
    const last = parts[parts.length - 1].toLowerCase();
    if (last.length <= 40 && (last.replace(/\s/g, "").includes(site) || /news|times|post|daily|tribune|herald|journal|online|tv|radio|\.com/.test(last))) {
      t = parts.slice(0, -1).join(" - ");
    }
  }
  const words = t.split(" ").filter((w) => /[a-z]/i.test(w));
  if (words.length < 4 || t.length > 220 || /^(home|news|live updates?)$/i.test(t)) return null;
  return t;
}

interface Located {
  lat: number;
  lon: number;
  precision: "city" | "region" | "country";
  name: string;
}

/** Choose where the story is: a geocoded mention the headline agrees with, else a cued headline place. */
export function locateArticle(a: GkgArticle, title: string): Located | null {
  const lower = ` ${title.toLowerCase()} `;
  const mentioned = (n: string) => n.length >= 3 && new RegExp(`[^a-z]${n.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:'?s)?[^a-z]`).test(lower);
  const byPrecision = [...a.locations].sort((x, y) => {
    const rank = (t: number) => (t === 3 || t === 4 ? 0 : t === 2 || t === 5 ? 1 : 2);
    return rank(x.type) - rank(y.type) || y.mentions - x.mentions;
  });
  for (const loc of byPrecision) {
    const first = loc.name.split(",")[0].trim();
    if (mentioned(first)) {
      return { lat: loc.lat, lon: loc.lon, precision: loc.type === 3 || loc.type === 4 ? "city" : loc.type === 1 ? "country" : "region", name: loc.name };
    }
  }
  const cued = placesInText(title).find((p) => p.cued);
  if (cued) {
    const [lon, lat] = cued.city ? [cued.city.lon, cued.city.lat] : cued.country.label;
    return { lat, lon, precision: cued.city ? (cued.city.population === 0 ? "region" : "city") : "country", name: cued.city ? `${cued.city.name}, ${cued.country.name}` : cued.country.name };
  }
  return null;
}

const stampIso = (s: string) => new Date(Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +s.slice(8, 10), +s.slice(10, 12), +s.slice(12, 14))).toISOString();

function hash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

interface Chosen {
  a: GkgArticle;
  title: string;
  rule: ThemeRule;
  loc: Located;
  tokens: Set<string>;
  cluster: number;
}

export function parseGkgArticles(raw: GkgRaw, ctx: ParseContext): ParseResult {
  let skipped = 0;
  const seenUrls = new Set<string>();
  const chosen: Chosen[] = [];
  for (const f of raw.files) {
    for (const a of f.articles) {
      const url = safeUrl(a.url);
      const title = url ? cleanTitle(a.title, a.source) : null;
      const rule = title ? classifyThemes(a.themes, title) : null;
      const loc = title && rule ? locateArticle(a, title) : null;
      if (!url || !title || !rule || !loc || seenUrls.has(url)) {
        skipped++;
        continue;
      }
      seenUrls.add(url);
      chosen.push({ a, title, rule, loc, tokens: tokenize(title), cluster: 1 });
    }
  }
  // Within-run clustering: how many other outlets carry a near-identical headline.
  for (let i = 0; i < chosen.length; i++)
    for (let j = i + 1; j < chosen.length; j++) {
      if (chosen[i].rule.category === chosen[j].rule.category && chosen[i].a.source !== chosen[j].a.source && headlineSimilarity(chosen[i].tokens, chosen[j].tokens) >= 0.5) {
        chosen[i].cluster++;
        chosen[j].cluster++;
      }
    }
  const score = (c: Chosen) => c.cluster * 2 + c.rule.weight + Math.min(Math.abs(c.a.tone ?? 0), 10) / 20 + (c.loc.precision === "city" ? 0.2 : 0);
  chosen.sort((x, y) => score(y) - score(x));
  skipped += Math.max(0, chosen.length - MAX_PER_RUN);

  const candidates: EventCandidateInput[] = chosen.slice(0, MAX_PER_RUN).map((c) => {
    const url = safeUrl(c.a.url)!;
    const host = new URL(url).hostname.replace(/^www\./, "");
    const at = stampIso(c.a.date);
    const reportedAt = Date.parse(at) <= Date.parse(ctx.retrievedAt) ? at : ctx.retrievedAt;
    const people = c.a.persons.slice(0, 4).map((n) => ({ type: "PERSON" as const, name: n.replace(/\b\w/g, (m) => m.toUpperCase()), code: null }));
    const orgs = c.a.organizations.slice(0, 4).map((n) => ({ type: "ORGANIZATION" as const, name: n.replace(/\b\w/g, (m) => m.toUpperCase()), code: null }));
    return {
      type: c.rule.category,
      subtype: c.rule.subtype,
      title: c.title,
      summary: `${host} reported: “${c.title}”. Located at ${c.loc.name} (${c.loc.precision} level) from places named in the headline and article. Topic tagged by GDELT's automated theme coding.`,
      latitude: c.loc.lat,
      longitude: c.loc.lon,
      geoPrecision: c.loc.precision,
      // Country-level: let the pipeline use the proper country name (GKG uses adjectives like "Russian").
      locationName: c.loc.precision === "country" ? null : c.loc.name,
      timestamp: reportedAt,
      metrics: {
        num_articles: c.cluster,
        avg_tone: c.a.tone === null ? null : Math.round(c.a.tone * 10) / 10,
        themes: c.a.themes.filter((t) => THEME_RULES.some((r) => r.match(t))).slice(0, 4).join(", ") || null,
      },
      entities: [...people, ...orgs],
      source: {
        id: `gdelt-gkg:${hash(url)}`,
        dataSourceId: "gdelt-gkg",
        externalId: hash(url),
        sourceName: host,
        sourceUrl: url,
        title: c.title,
        titleIsDerived: false,
        publishedAt: reportedAt,
        retrievedAt: ctx.retrievedAt,
        sourceType: "NEWS_MEDIA",
        assertion: "MEDIA_REPORT",
        credibility: null,
      },
      rawData: { themes: c.a.themes.slice(0, 10), locations: c.a.locations.slice(0, 3), source: c.a.source },
    };
  });
  return { candidates, skipped };
}
