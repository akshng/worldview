/**
 * U.S. SEC enforcement and press feeds (keyless RSS; SEC fair-access User-Agent): trading
 * suspensions, litigation releases, administrative proceedings and press releases. Suspension,
 * litigation and proceeding items are titled only with the respondent's name upstream, so the
 * event title says which kind of SEC action it is; the name itself is never rewritten.
 * Placed at SEC headquarters in Washington (the respondents' locations are not published).
 */
import type { EventCandidateInput } from "@/types/events";
import { plainText, safeUrl, type DataSourceConnector, type FetchContext, type ParseContext, type ParseResult } from "../types";
import { HQ, clip, fetchEach, hashId, makeSource, readFeedItems, type RssItem } from "../official-common";

export const SEC_FEEDS = [
  { id: "suspension", label: "SEC trading suspension", url: "https://www.sec.gov/enforcement-litigation/trading-suspensions/rss" },
  { id: "litigation", label: "SEC litigation release", url: "https://www.sec.gov/enforcement-litigation/litigation-releases/rss" },
  { id: "admin", label: "SEC administrative proceeding", url: "https://www.sec.gov/enforcement-litigation/administrative-proceedings/rss" },
  { id: "press", label: "SEC press release", url: "https://www.sec.gov/news/pressreleases.rss" },
] as const;
type FeedId = (typeof SEC_FEEDS)[number]["id"];

export interface SecEnforcementRaw {
  feeds: Array<{ feed: FeedId; items: RssItem[] }>;
}

const MAX_AGE_MS = 14 * 86_400_000;

export async function fetchSecEnforcement(ctx: FetchContext): Promise<SecEnforcementRaw> {
  // Four requests per run, sequential enough for SEC's ≤ 10 requests/second.
  const ok = await fetchEach(ctx, SEC_FEEDS, readFeedItems);
  return { feeds: ok.map(({ feed, data }) => ({ feed: feed.id, items: data.slice(0, 40) })) };
}

/** Release number from the link: "…/lr-26677" → "LR-26677", "…/2026/34-106668.pdf" → "34-106668". */
export function releaseNumber(link: string): string | null {
  const last = link.replace(/\/+$/, "").split("/").pop() ?? "";
  const m = last.replace(/\.pdf$/i, "").match(/^((?:lr|ia|ic|33|34|ae|ad|ia)-\d{3,7})$/i);
  return m ? m[1].toUpperCase() : null;
}

export function parseSecEnforcement(raw: SecEnforcementRaw, ctx: ParseContext): ParseResult {
  const candidates: EventCandidateInput[] = [];
  let skipped = 0;
  const seen = new Set<string>();
  for (const { feed, items } of raw.feeds ?? []) {
    const def = SEC_FEEDS.find((f) => f.id === feed);
    if (!def) continue;
    for (const it of items) {
      const name = plainText(it.title, 300);
      const link = safeUrl(it.link?.trim());
      const t = it.published ? Date.parse(it.published) : NaN;
      if (!name || name.length < 3 || !link || Number.isNaN(t) || ctx.now - t > MAX_AGE_MS || t > ctx.now + 3_600_000) {
        skipped++;
        continue;
      }
      const number = releaseNumber(link);
      const externalId = `${feed}:${number ?? hashId(link)}`;
      if (seen.has(externalId)) {
        skipped++;
        continue;
      }
      seen.add(externalId);
      const ts = new Date(t).toISOString();
      const press = feed === "press";
      const enforcement = press && /\b(charges?|charged|settles?|fraud|penalt|halts|obtains|judgment|suspends)\b/i.test(name);
      const subtype = press ? (enforcement ? "enforcement action" : "SEC press release") : def.label.replace(/^SEC /, "");
      const title = clip(press ? (/\bSEC\b/.test(name) ? name : `SEC: ${name}`) : `${def.label}${number ? ` ${number}` : ""}: ${name}`);
      const description = plainText(it.description, 1500);
      candidates.push({
        type: "MARKETS",
        subtype,
        title,
        summary: press
          ? `U.S. Securities and Exchange Commission press release of ${ts.slice(0, 10)}: “${name}”.`
          : `The U.S. Securities and Exchange Commission published a ${def.label.replace(/^SEC /, "")}${number ? ` (${number})` : ""} concerning ${name} on ${ts.slice(0, 10)}. See the release for the allegations or order; shown at SEC headquarters.`,
        description: description && description !== name ? description : null,
        latitude: HQ.sec.lat,
        longitude: HQ.sec.lon,
        geoPrecision: "city",
        locationName: HQ.sec.name,
        country: HQ.sec.country,
        timestamp: ts,
        metrics: { release: number, kind: def.label },
        entities: [
          { type: "ORGANIZATION", name: "U.S. Securities and Exchange Commission", code: "SEC" },
          ...(feed === "suspension" ? [{ type: "ORGANIZATION" as const, name, code: null }] : []),
        ],
        source: makeSource({
          dataSourceId: "sec-enforcement",
          externalId,
          sourceName: `U.S. SEC — ${def.label.replace(/^SEC /, "")}s`,
          sourceUrl: link,
          title: name,
          publishedAt: ts,
          retrievedAt: ctx.retrievedAt,
          basis: "U.S. Securities and Exchange Commission official RSS feed",
        }),
        rawData: { feed, link, published: it.published },
      });
    }
  }
  return { candidates, skipped };
}

export const secEnforcementConnector: DataSourceConnector<SecEnforcementRaw> = {
  id: "sec-enforcement",
  name: "SEC enforcement",
  description: "SEC trading suspensions, litigation releases, administrative proceedings and press releases (last 14 days), at SEC headquarters.",
  homepage: "https://www.sec.gov/enforcement-litigation",
  attribution: "U.S. Securities and Exchange Commission — public domain",
  sourceType: "OFFICIAL_AGENCY",
  categories: ["MARKETS"],
  refreshIntervalMs: 30 * 60_000,
  mode: "live",
  fetch: fetchSecEnforcement,
  parse: parseSecEnforcement,
};
