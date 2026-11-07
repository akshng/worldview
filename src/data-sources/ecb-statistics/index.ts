/**
 * European Central Bank statistical press releases RSS (`rss/statpress.html`, keyless):
 * euro-area monetary developments (M3, loans to the private sector), bank interest rates,
 * balance of payments, financial accounts — and the accounts of Governing Council monetary
 * policy meetings. Scheduled data releases that move euro rates; the `central-banks` connector
 * carries the ECB's general press feed (decisions, speeches), not these. Last 14 days, at the
 * ECB in Frankfurt.
 */
import { HQ } from "../official-common";
import { agencyConnector, fetchAgencyFeeds, type AgencyFeed, type AgencyFeedsRaw, type AgencySpec } from "../agency-feeds/common";

export const ECB_STAT_FEEDS: AgencyFeed[] = [
  {
    id: "statpress",
    name: "European Central Bank",
    alias: /\bECB\b|\bEuropean Central Bank\b/,
    prefix: "ECB",
    url: "https://www.ecb.europa.eu/rss/statpress.html",
    place: HQ.ecb,
    basis: "Euro-area central bank (official statistical releases)",
  },
];

/** Release kind from the title / link path. */
export function ecbStatKind(title: string, link: string): { subtype: string; title?: string } {
  if (/^Meeting of\b/i.test(title) || /\/press\/accounts\//.test(link)) return { subtype: "monetary policy account", title: `ECB: Account of the monetary policy meeting of ${title.replace(/^Meeting of\s*/i, "")}` };
  if (/monetary developments/i.test(title)) return { subtype: "money and credit (M3)" };
  if (/bank interest rate/i.test(title)) return { subtype: "bank interest rates" };
  if (/balance of payments|international investment position/i.test(title)) return { subtype: "balance of payments" };
  if (/financial (developments|accounts)|institutional sector|households and non-financial/i.test(title)) return { subtype: "financial accounts" };
  if (/investment funds?|insurance|pension/i.test(title)) return { subtype: "financial institutions statistics" };
  if (/securities|debt/i.test(title)) return { subtype: "securities statistics" };
  if (/payments? statistics|card/i.test(title)) return { subtype: "payments statistics" };
  return { subtype: "ECB statistical release" };
}

export const ecbStatSpec: AgencySpec<AgencyFeed> = {
  dataSourceId: "ecb-statistics",
  feeds: ECB_STAT_FEEDS,
  maxAgeMs: 14 * 86_400_000,
  classify: ({ title, link }) => {
    const k = ecbStatKind(title, link);
    return { type: "MARKETS", subtype: k.subtype, title: k.title ?? `ECB: ${title}` };
  },
};

const base = agencyConnector(ecbStatSpec, {
  name: "ECB statistical releases",
  description: "European Central Bank statistical press releases — euro-area money and credit, bank lending rates, balance of payments, financial accounts — and monetary policy meeting accounts (last 14 days).",
  homepage: "https://www.ecb.europa.eu/press/stats/html/index.en.html",
  attribution: "European Central Bank — ecb.europa.eu RSS; reuse permitted with the source acknowledged",
  categories: ["MARKETS"],
  refreshIntervalMs: 60 * 60_000,
});

/** ECB links carry a double slash ("europa.eu//press/…"). */
export async function fetchEcbStat(ctx: Parameters<typeof base.fetch>[0]): Promise<AgencyFeedsRaw> {
  const raw = await fetchAgencyFeeds(ctx, ECB_STAT_FEEDS, 40);
  return { feeds: raw.feeds.map((f) => ({ ...f, items: f.items.map((it) => ({ ...it, link: it.link?.replace(/^(https?:\/\/[^/]+)\/\/+/, "$1/") })) })) };
}

export const ecbStatisticsConnector = { ...base, fetch: fetchEcbStat };
