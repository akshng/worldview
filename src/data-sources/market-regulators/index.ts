/**
 * U.S. market regulators' press releases (keyless RSS): SEC press releases and CFTC general
 * press releases — enforcement actions, rule adoptions, roundtables, agreements with foreign
 * regulators. Placed at each regulator's headquarters in Washington, DC.
 *
 * SEC litigation releases (sec.gov/enforcement-litigation/litigation-releases/rss) were not
 * added: sec.gov answered that feed with 403 "Request Rate Threshold Exceeded" to WorldView's
 * identified client during verification.
 */
import { agencyConnector, maxDollarAmount, type AgencyFeed, type AgencySpec } from "../agency-feeds/common";

const SEC_HQ = { lat: 38.8977, lon: -77.0063, name: "U.S. SEC headquarters, Washington, DC", country: "US" };
const CFTC_HQ = { lat: 38.9046, lon: -77.0469, name: "U.S. CFTC (Three Lafayette Centre), Washington, DC", country: "US" };

export const REGULATOR_FEEDS: AgencyFeed[] = [
  {
    id: "sec",
    name: "U.S. Securities and Exchange Commission",
    prefix: "SEC",
    alias: /\bSEC\b|Securities and Exchange Commission/,
    url: "https://www.sec.gov/news/pressreleases.rss",
    place: SEC_HQ,
    basis: "U.S. federal regulator (SEC press releases)",
  },
  {
    id: "cftc",
    name: "U.S. Commodity Futures Trading Commission",
    prefix: "CFTC",
    alias: /\bCFTC\b|Commodity Futures Trading Commission/,
    url: "https://www.cftc.gov/RSS/RSSGP/rssgp.xml",
    place: CFTC_HQ,
    basis: "U.S. federal regulator (CFTC press releases)",
  },
];

export function regulatorSubtype(title: string): string {
  if (/\b(charges?|charged|sues|lawsuit|complaint|settles?|settlement|penalt(y|ies)|fines?|fraud|enforcement|orders? .* to pay|barred|obtains? (final )?judgment)\b/i.test(title)) return "enforcement action";
  if (/\b(adopts?|proposes?|final rule|proposed rule|rulemaking|amendments?|exemptive|guidance|staff (statement|letter|advisory)|no-action)\b/i.test(title)) return "rulemaking";
  if (/\b(roundtable|hearing|open meeting|advisory committee|conference)\b/i.test(title)) return "meeting";
  if (/\b(MOU|memorandum of understanding|dialogue|cooperation)\b/i.test(title)) return "international cooperation";
  return "regulator release";
}

export const regulatorsSpec: AgencySpec<AgencyFeed> = {
  dataSourceId: "market-regulators",
  feeds: REGULATOR_FEEDS,
  maxAgeMs: 10 * 86_400_000,
  classify: ({ title }) => ({ type: "MARKETS", subtype: regulatorSubtype(title), metrics: { amount_usd: maxDollarAmount(title) } }),
};

export const marketRegulatorsConnector = agencyConnector(regulatorsSpec, {
  name: "SEC & CFTC press releases",
  description: "SEC and CFTC press releases (enforcement actions, rules, meetings), last 10 days, at each regulator's headquarters.",
  homepage: "https://www.sec.gov/newsroom/press-releases",
  attribution: "U.S. Securities and Exchange Commission and U.S. Commodity Futures Trading Commission — public domain U.S. government works",
  categories: ["MARKETS"],
  refreshIntervalMs: 30 * 60_000,
});
