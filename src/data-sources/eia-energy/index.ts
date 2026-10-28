/**
 * U.S. Energy Information Administration keyless RSS feeds (not the keyed API): "Today in
 * Energy" analysis articles and EIA press releases (Short-Term Energy Outlook, Winter Fuels
 * Outlook, …). Placed at EIA headquarters, Washington, DC.
 */
import { agencyConnector, type AgencyFeed, type AgencySpec } from "../agency-feeds/common";

const EIA_HQ = { lat: 38.8868, lon: -77.0257, name: "U.S. EIA (Forrestal Building), Washington, DC", country: "US" };

export const EIA_FEEDS: AgencyFeed[] = [
  {
    id: "today",
    name: "U.S. EIA — Today in Energy",
    prefix: "EIA",
    alias: /\bEIA\b/,
    url: "https://www.eia.gov/rss/todayinenergy.xml",
    place: EIA_HQ,
    basis: "U.S. federal statistical agency (Energy Information Administration)",
  },
  {
    id: "press",
    name: "U.S. EIA — press releases",
    prefix: "EIA",
    alias: /\bEIA\b/,
    url: "https://www.eia.gov/rss/press_rss.xml",
    place: EIA_HQ,
    basis: "U.S. federal statistical agency (Energy Information Administration)",
  },
];

export function eiaTopic(text: string): string | null {
  if (/\b(crude|oil|petroleum|gasoline|diesel|distillate|refiner(y|ies)|refining|jet fuel|OPEC)\b/i.test(text)) return "oil";
  if (/\b(natural gas|LNG|Henry Hub)\b/i.test(text)) return "natural gas";
  if (/\b(electric|power|grid|generation|solar|wind|nuclear|coal)\b/i.test(text)) return "power";
  return null;
}

export const eiaSpec: AgencySpec<AgencyFeed> = {
  dataSourceId: "eia-energy",
  feeds: EIA_FEEDS,
  maxAgeMs: 14 * 86_400_000,
  classify: ({ feed, title }) => {
    const outlook = /\b(Short-Term Energy Outlook|STEO|Annual Energy Outlook|International Energy Outlook|Winter Fuels Outlook|expects?|forecasts?)\b/i.test(title);
    return {
      type: "MARKETS",
      subtype: feed.id === "press" ? (outlook ? "energy outlook" : "energy press release") : "energy analysis",
      metrics: { topic: eiaTopic(title) },
    };
  },
};

export const eiaEnergyConnector = agencyConnector(eiaSpec, {
  name: "U.S. EIA energy releases",
  description: "U.S. Energy Information Administration “Today in Energy” articles and press releases (outlooks), last 14 days.",
  homepage: "https://www.eia.gov/todayinenergy/",
  attribution: "U.S. Energy Information Administration — public domain U.S. government data; cite EIA",
  categories: ["MARKETS"],
  refreshIntervalMs: 60 * 60_000,
});
