/**
 * Trade policy: WTO latest news RSS (disputes, trade remedies notified by members, trade policy
 * reviews) and the Office of the U.S. Trade Representative press releases RSS (tariff actions,
 * Section 301, trade agreements). WTO items naming a member are shown in that member; the
 * rest at WTO headquarters in Geneva. USTR items are shown at USTR in Washington.
 */
import { agencyConnector, headlinePlace, type AgencyFeed, type AgencySpec } from "../agency-feeds/common";

const WTO_HQ = { lat: 46.2236, lon: 6.149, name: "World Trade Organization (Centre William Rappard), Geneva", country: "CH" };
const USTR_HQ = { lat: 38.8987, lon: -77.0396, name: "Office of the U.S. Trade Representative, Washington, DC", country: "US" };

export const TRADE_FEEDS: AgencyFeed[] = [
  {
    id: "wto",
    name: "World Trade Organization",
    prefix: "WTO",
    alias: /\bWTO\b|World Trade Organization/i,
    url: "https://www.wto.org/library/rss/latest_news_e.xml",
    place: WTO_HQ,
    basis: "Intergovernmental organisation (WTO Secretariat news)",
  },
  {
    id: "ustr",
    name: "Office of the U.S. Trade Representative",
    prefix: "USTR",
    alias: /\b(USTR|Trade Representative|Ambassador Greer|United States|U\.S\.)/i,
    url: "https://ustr.gov/rss.xml",
    place: USTR_HQ,
    basis: "U.S. federal agency (Executive Office of the President)",
  },
];

export function tradeSubtype(text: string): { subtype: string; market: boolean } {
  if (/\b(anti-?dumping|countervailing|safeguard)\b/i.test(text)) return { subtype: "trade remedy", market: true };
  if (/\b(dispute|panel report|Appellate|consultations? request|DS\d+)\b/i.test(text)) return { subtype: "trade dispute", market: true };
  if (/\b(tariffs?|duties|Section (301|232|201)|import restrictions?|export controls?)\b/i.test(text)) return { subtype: "tariff action", market: true };
  if (/\b(trade agreement|free trade|FTA|trade deal|framework agreement)\b/i.test(text)) return { subtype: "trade agreement", market: true };
  if (/\bTrade Policy Review\b/i.test(text)) return { subtype: "trade policy review", market: false };
  return { subtype: "trade policy", market: false };
}

export const tradeSpec: AgencySpec<AgencyFeed> = {
  dataSourceId: "trade-policy",
  feeds: TRADE_FEEDS,
  maxAgeMs: 10 * 86_400_000,
  classify: ({ feed, title }) => {
    const { subtype, market } = tradeSubtype(title);
    return {
      type: market ? "MARKETS" : "POLITICS",
      subtype,
      located: feed.id === "wto" ? headlinePlace(title, "CH", "the WTO in Geneva") : null,
    };
  },
};

export const tradePolicyConnector = agencyConnector(tradeSpec, {
  name: "Trade policy (WTO, USTR)",
  description: "WTO news (disputes, trade remedies, trade policy reviews) and USTR press releases (tariffs, Section 301, agreements), last 10 days.",
  homepage: "https://www.wto.org/english/news_e/news_e.htm",
  attribution: "World Trade Organization (wto.org; reproduction with attribution) and Office of the U.S. Trade Representative (public domain)",
  categories: ["MARKETS", "POLITICS"],
  refreshIntervalMs: 30 * 60_000,
});
