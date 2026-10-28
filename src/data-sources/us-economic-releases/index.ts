/**
 * U.S. economic data releases from the official keyless RSS feeds of the Bureau of Economic
 * Analysis (GDP, personal income and outlays / PCE, international trade, international
 * transactions) and the Census Bureau Economic Briefing Room (retail sales, durable goods,
 * housing starts, new home sales, construction spending, advance trade and inventories, …).
 * Each release is shown at the Suitland Federal Center (Maryland), where both bureaus sit.
 * Headline numbers are quoted from the bureau's own release text, never computed.
 */
import { agencyConnector, type AgencyFeed, type AgencySpec, type FeedItemView } from "../agency-feeds/common";

const SUITLAND = { lat: 38.8462, lon: -76.931, name: "Suitland Federal Center (BEA / Census Bureau), Maryland", country: "US" };

export const ECON_FEEDS: AgencyFeed[] = [
  {
    id: "bea",
    name: "U.S. Bureau of Economic Analysis",
    prefix: "BEA",
    alias: /\bBEA\b/,
    url: "https://apps.bea.gov/rss/rss.xml",
    place: SUITLAND,
    basis: "U.S. federal statistical agency (Bureau of Economic Analysis)",
  },
  {
    id: "census",
    name: "U.S. Census Bureau — economic indicators",
    prefix: "Census Bureau",
    alias: /\bCensus\b/,
    url: "https://www.census.gov/economic-indicators/indicator.xml",
    place: SUITLAND,
    basis: "U.S. federal statistical agency (Census Bureau Economic Briefing Room)",
  },
];

/** Reference period of a Census release: the first "<period>: <change>" line of its description. */
export function censusPeriod(description: string): string | null {
  const m = description.match(/\b((?:January|February|March|April|May|June|July|August|September|October|November|December) \d{4}|\d(?:st|nd|rd|th) (?:Qtr|Quarter) \d{4})\b(?: \(\w+\))?:/);
  return m ? m[1] : null;
}

export function indicatorOf(title: string): string {
  if (/\bGDP\b|Gross Domestic Product/i.test(title)) return "GDP";
  if (/Personal Income and Outlays|\bPCE\b/i.test(title)) return "personal income & PCE";
  if (/International Trade/i.test(title)) return "trade balance";
  if (/International Transactions/i.test(title)) return "current account";
  if (/Retail (Sales|Trade)/i.test(title) && !/Inventor/i.test(title)) return "retail sales";
  if (/Durable Goods/i.test(title)) return "durable goods";
  if (/Housing Starts|New Residential Construction/i.test(title)) return "housing starts";
  if (/New (Home|Residential) Sales/i.test(title)) return "new home sales";
  if (/Construction Spending/i.test(title)) return "construction spending";
  if (/Inventor/i.test(title)) return "inventories";
  if (/Homeownership|Vacancy/i.test(title)) return "housing vacancies";
  return "economic indicator";
}

/** Headline-moving releases (the ones markets schedule around). */
const MARKET_MOVING = new Set(["GDP", "personal income & PCE", "trade balance", "retail sales", "durable goods", "housing starts", "new home sales"]);

export const econSpec: AgencySpec<AgencyFeed> = {
  dataSourceId: "us-economic-releases",
  feeds: ECON_FEEDS,
  maxAgeMs: 7 * 86_400_000,
  // Census reuses one guid/link per indicator, so the release is keyed by title + date.
  idKey: (v: FeedItemView) => (v.feed.id === "census" ? `${v.title}|${v.published}` : v.link),
  classify: ({ feed, title, description }) => {
    const indicator = indicatorOf(title);
    const period = feed.id === "census" ? censusPeriod(description) : null;
    const lead = description.split(/(?<=\.)\s/)[0];
    return {
      type: "MARKETS",
      subtype: "economic data release",
      title: feed.id === "census" ? `Census Bureau: ${title}${period ? ` (${period})` : ""}` : undefined,
      metrics: { indicator, period, market_moving: MARKET_MOVING.has(indicator) },
      extra: lead && lead.length > 20 && lead !== title ? `Release text: “${lead.slice(0, 600)}”` : undefined,
    };
  },
};

export const usEconomicReleasesConnector = agencyConnector(econSpec, {
  name: "U.S. economic releases (BEA, Census)",
  description: "Official U.S. economic data releases — GDP, PCE, trade, retail sales, durable goods, housing — from BEA and Census Bureau feeds (last 7 days).",
  homepage: "https://www.census.gov/economic-indicators/",
  attribution: "U.S. Bureau of Economic Analysis and U.S. Census Bureau — public domain U.S. government data",
  categories: ["MARKETS"],
  refreshIntervalMs: 15 * 60_000,
});
