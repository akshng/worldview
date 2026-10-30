/**
 * European Medicines Agency news RSS (keyless): CHMP/PRAC meeting highlights, safety reviews,
 * shortages and approvals news. Placed at EMA headquarters, Amsterdam, unless the headline
 * names a country outside the Netherlands.
 */
import { agencyConnector, headlinePlace, type AgencyFeed, type AgencySpec } from "../agency-feeds/common";

const EMA_HQ = { lat: 52.3384, lon: 4.8707, name: "European Medicines Agency, Amsterdam", country: "NL" };

export const EMA_FEEDS: AgencyFeed[] = [
  {
    id: "news",
    name: "European Medicines Agency",
    alias: /\b(EMA|European Medicines Agency|CHMP|PRAC)\b/,
    prefix: "EMA",
    url: "https://www.ema.europa.eu/en/news.xml",
    place: EMA_HQ,
    basis: "EU agency (European Medicines Agency)",
  },
];

export function emaSubtype(title: string): string {
  if (/\b(CHMP|PRAC|CMDh|COMP|PDCO|CAT|HMPC)\b.*\b(highlights|meeting)\b|\bmeeting highlights\b/i.test(title)) return "committee highlights";
  if (/\b(safety|risk|side effects?|adverse|suspen\w+|withdraw\w*|restrict\w*|review)\b/i.test(title)) return "safety review";
  if (/\bshortages?\b/i.test(title)) return "medicine shortage";
  if (/\b(recommend\w*|approv\w*|authori[sz]\w*|positive opinion|new medicine|vaccine)\b/i.test(title)) return "medicine approval";
  return "medicines news";
}

export const emaSpec: AgencySpec<AgencyFeed> = {
  dataSourceId: "ema-medicines",
  feeds: EMA_FEEDS,
  maxAgeMs: 14 * 86_400_000,
  classify: ({ title }) => ({
    type: "HEALTH",
    subtype: emaSubtype(title),
    located: headlinePlace(title, "NL", "the European Medicines Agency"),
  }),
};

export const emaMedicinesConnector = agencyConnector(emaSpec, {
  name: "European Medicines Agency news",
  description: "EMA news from the last 14 days: committee highlights (CHMP, PRAC), safety reviews, shortages and medicine recommendations.",
  homepage: "https://www.ema.europa.eu/en/news-events",
  attribution: "© European Medicines Agency — reproduction authorised with acknowledgement of the source; link back to each item",
  categories: ["HEALTH"],
  refreshIntervalMs: 60 * 60_000,
});
