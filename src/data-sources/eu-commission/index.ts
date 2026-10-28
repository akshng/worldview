/**
 * European Commission Press Corner RSS (keyless, English): press releases (IP), statements,
 * readouts and joint press releases. Speeches, daily news digests, Q&As, factsheets and
 * agendas are skipped. Competition, trade and financial decisions are labelled MARKETS.
 * Placed in a non-EU-HQ country the headline names, else at the Berlaymont, Brussels.
 */
import { agencyConnector, headlinePlace, type AgencyFeed, type AgencySpec } from "../agency-feeds/common";

const BERLAYMONT = { lat: 50.8436, lon: 4.3823, name: "European Commission (Berlaymont), Brussels", country: "BE" };

export const EC_FEEDS: AgencyFeed[] = [
  {
    id: "presscorner",
    name: "European Commission",
    prefix: "European Commission",
    alias: /\b(Commission|Commissioner|EU|European Union|President von der Leyen)\b/,
    url: "https://ec.europa.eu/commission/presscorner/api/rss?language=en&pagesize=60",
    place: BERLAYMONT,
    basis: "EU executive (European Commission Directorate-General for Communication)",
  },
];

/** Press Corner document kinds kept (from the id in the link, e.g. ip_26_2274). */
const KEEP_KINDS = new Set(["ip", "statement", "read", "jp", "inf"]);

export function ecDocKind(link: string): string | null {
  const m = link.match(/\/presscorner\/detail\/en\/([a-z]+)_\d+_\d+/i);
  return m ? m[1].toLowerCase() : null;
}

const MARKET = /\b(antitrust|competition|merger|acquisition|State aid|fines?|cartel|anti-?dumping|countervailing|tariffs?|duties|trade (agreement|deal|defence|measures?)|customs|sanctions|Digital Markets Act|DMA|Digital Services Act|DSA|bonds?|borrowing|bank|financial|capital markets|NextGenerationEU|budget|euro\b)/i;

export function ecSubtype(title: string): { type: "MARKETS" | "POLITICS"; subtype: string } {
  if (/\b(antitrust|competition|merger|acquisition|State aid|cartel|Digital Markets Act|DMA)\b/i.test(title)) return { type: "MARKETS", subtype: "competition decision" };
  if (/\b(anti-?dumping|countervailing|tariffs?|duties|trade (agreement|deal|defence|measures?))\b/i.test(title)) return { type: "MARKETS", subtype: "trade measure" };
  if (/\bsanctions?\b/i.test(title)) return { type: "POLITICS", subtype: "sanctions" };
  if (MARKET.test(title)) return { type: "MARKETS", subtype: "economic policy" };
  return { type: "POLITICS", subtype: "EU Commission release" };
}

export const ecSpec: AgencySpec<AgencyFeed> = {
  dataSourceId: "eu-commission",
  feeds: EC_FEEDS,
  maxAgeMs: 7 * 86_400_000,
  classify: ({ title, link }) => {
    const kind = ecDocKind(link);
    if (!kind || !KEEP_KINDS.has(kind)) return null;
    const { type, subtype } = ecSubtype(title);
    return { type, subtype, metrics: { document_kind: kind }, located: headlinePlace(title, "BE", "the European Commission in Brussels") };
  },
};

export const euCommissionConnector = agencyConnector(ecSpec, {
  name: "European Commission press releases",
  description: "European Commission Press Corner press releases, statements and readouts (last 7 days); competition and trade decisions labelled.",
  homepage: "https://ec.europa.eu/commission/presscorner/home/en",
  attribution: "© European Union — European Commission Press Corner; reuse authorised with acknowledgement of the source (Commission Decision 2011/833/EU)",
  categories: ["POLITICS", "MARKETS"],
  refreshIntervalMs: 30 * 60_000,
});
