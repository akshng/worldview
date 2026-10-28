/**
 * Central-bank press releases: Federal Reserve, ECB, Bank of England, Bank of Japan and
 * Bank of Canada official RSS feeds (keyless). Placed at each bank's headquarters.
 * Rate decisions are recognised from the bank's own release title and labelled as such;
 * the title text itself is never rewritten.
 */
import type { EventCandidateInput } from "@/types/events";
import { plainText, safeUrl, type DataSourceConnector, type FetchContext, type ParseContext, type ParseResult } from "../types";
import { HQ, clip, fetchEach, hashId, makeSource, readFeedItems, type Place, type RssItem } from "../official-common";

export interface CentralBank {
  id: "fed" | "ecb" | "boe" | "boj" | "boc";
  name: string;
  url: string;
  place: Place;
  /** Release titles that announce a policy-rate decision. */
  rateDecision: RegExp;
  /** Other monetary-policy releases (minutes, projections, summaries of opinions). */
  monetary: RegExp;
  /** Short names that count as naming the bank in a title. */
  alias: RegExp;
  /** Routine items not worth an event (statistics, approvals of bank applications, committee minutes). */
  skip?: (it: RssItem) => boolean;
}

export const CENTRAL_BANKS: CentralBank[] = [
  {
    id: "fed",
    alias: /^Federal Reserve\b|\bFOMC\b/,
    name: "Federal Reserve",
    url: "https://www.federalreserve.gov/feeds/press_all.xml",
    place: HQ.federalReserve,
    rateDecision: /\bFOMC statement\b/i,
    monetary: /\b(FOMC|Federal Open Market Committee|discount rate|monetary policy)\b/i,
    skip: (it) => /announces approval of (an )?application/i.test(it.title),
  },
  {
    id: "ecb",
    alias: /\bECB\b/,
    name: "European Central Bank",
    url: "https://www.ecb.europa.eu/rss/press.html",
    place: HQ.ecb,
    rateDecision: /^monetary policy decisions?$/i,
    monetary: /\b(monetary policy|Governing Council|Meeting of \d)/i,
  },
  {
    id: "boe",
    alias: /\bBank of England\b/,
    name: "Bank of England",
    url: "https://www.bankofengland.co.uk/rss/news",
    place: HQ.bankOfEngland,
    rateDecision: /^Bank Rate (maintained|reduced|increased|raised|cut|held|lowered)\b/i,
    monetary: /\b(Monetary Policy|MPC|Asset Purchase Facility|Financial Policy Committee)\b/i,
    skip: (it) => /^Minutes of the (?!Monetary Policy Committee)/i.test(it.title),
  },
  {
    id: "boj",
    alias: /\bBOJ\b/,
    name: "Bank of Japan",
    url: "https://www.boj.or.jp/en/rss/whatsnew.xml",
    place: HQ.bankOfJapan,
    rateDecision: /^Statement on Monetary Policy\b/i,
    monetary: /\b(Monetary Policy|Outlook for Economic Activity and Prices)\b/i,
    // The feed is mostly statistical releases (price indices, accounts, money stock).
    skip: (it) => /\/en\/(statistics|research\/research_data)\//i.test(it.link),
  },
  {
    id: "boc",
    alias: /\bBank of Canada\b/,
    name: "Bank of Canada",
    url: "https://www.bankofcanada.ca/content_type/press-releases/feed/",
    place: HQ.bankOfCanada,
    rateDecision: /\b(maintains|lowers|raises|reduces|increases|cuts|holds) (the |its )?policy (interest )?rate\b/i,
    monetary: /\b(Monetary Policy|policy interest rate)\b/i,
  },
];

export interface CentralBanksRaw {
  feeds: Array<{ bank: CentralBank["id"]; items: RssItem[] }>;
}

const MAX_AGE_MS = 14 * 86_400_000;

export async function fetchCentralBanks(ctx: FetchContext, banks: CentralBank[] = CENTRAL_BANKS): Promise<CentralBanksRaw> {
  const ok = await fetchEach(ctx, banks, readFeedItems);
  return { feeds: ok.map(({ feed, data }) => ({ bank: feed.id, items: data.slice(0, 60) })) };
}

export function classifyRelease(bank: CentralBank, title: string): "rate decision" | "monetary policy" | "enforcement action" | "speech" | "central bank release" {
  if (bank.rateDecision.test(title)) return "rate decision";
  if (bank.monetary.test(title)) return "monetary policy";
  if (/\benforcement action/i.test(title)) return "enforcement action";
  // ECB speeches and interviews: "Christine Lagarde: …"
  if (bank.id === "ecb" && /^[A-Z][\w.' -]{2,40}:\s/.test(title)) return "speech";
  return "central bank release";
}

export function parseCentralBanks(raw: CentralBanksRaw, ctx: ParseContext): ParseResult {
  const candidates: EventCandidateInput[] = [];
  let skipped = 0;
  const seen = new Set<string>();
  for (const { bank: id, items } of raw.feeds ?? []) {
    const bank = CENTRAL_BANKS.find((b) => b.id === id);
    if (!bank) continue;
    for (const it of items) {
      const title = plainText(it.title, 400);
      const link = safeUrl(it.link);
      const t = it.published ? Date.parse(it.published) : NaN;
      if (!title || title.length < 5 || !link || Number.isNaN(t) || ctx.now - t > MAX_AGE_MS || t > ctx.now + 3_600_000 || bank.skip?.(it)) {
        skipped++;
        continue;
      }
      const externalId = `${bank.id}:${hashId(link.replace(/^http:/, "https:"))}`;
      if (seen.has(externalId)) {
        skipped++;
        continue;
      }
      seen.add(externalId);
      const subtype = classifyRelease(bank, title);
      const published = new Date(t).toISOString();
      const named = title.toLowerCase().includes(bank.name.toLowerCase()) || bank.alias.test(title);
      const shown = subtype === "rate decision" ? `Rate decision — ${named ? title : `${bank.name}: ${title}`}` : named ? title : `${bank.name}: ${title}`;
      const description = plainText(it.description, 1500);
      candidates.push({
        type: "MARKETS",
        subtype,
        title: clip(shown),
        summary: `${bank.name} published “${title}” on ${published.slice(0, 16).replace("T", " ")} UTC.${subtype === "rate decision" ? " This release announces a policy-rate decision; see the release for the rate." : ""}`,
        description: description && description !== title ? description : null,
        latitude: bank.place.lat,
        longitude: bank.place.lon,
        geoPrecision: "city",
        locationName: bank.place.name,
        country: bank.place.country,
        timestamp: published,
        metrics: { bank: bank.name, rate_decision: subtype === "rate decision" },
        entities: [{ type: "ORGANIZATION", name: bank.name, code: bank.id.toUpperCase() }],
        source: makeSource({
          dataSourceId: "central-banks",
          externalId,
          sourceName: `${bank.name} — press releases`,
          sourceUrl: link,
          title,
          publishedAt: published,
          retrievedAt: ctx.retrievedAt,
          basis: `${bank.name} (central bank) official RSS feed`,
        }),
        rawData: { bank: bank.id, link, published: it.published },
      });
    }
  }
  return { candidates, skipped };
}

export const centralBanksConnector: DataSourceConnector<CentralBanksRaw> = {
  id: "central-banks",
  name: "Central bank releases",
  description: "Press releases from the Federal Reserve, ECB, Bank of England, Bank of Japan and Bank of Canada (last 14 days); rate decisions labelled.",
  homepage: "https://www.federalreserve.gov/newsevents/pressreleases.htm",
  attribution: "Federal Reserve Board (public domain), European Central Bank, Bank of England, Bank of Japan, Bank of Canada — official RSS feeds; link back to each release",
  sourceType: "OFFICIAL_AGENCY",
  categories: ["MARKETS"],
  refreshIntervalMs: 15 * 60_000,
  timeoutMs: 30_000,
  mode: "live",
  fetch: (ctx) => fetchCentralBanks(ctx),
  parse: parseCentralBanks,
};
