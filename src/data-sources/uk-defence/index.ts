/**
 * UK Ministry of Defence news and communications from the GOV.UK search Atom feed (keyless,
 * Open Government Licence v3): press releases, statements, deployments and defence-industry
 * announcements, last 7 days. Placed in a foreign country the headline names (e.g. Ukraine,
 * Estonia), else at the MOD Main Building, Whitehall.
 */
import { agencyConnector, headlinePlace, type AgencyFeed, type AgencySpec } from "../agency-feeds/common";

const MOD = { lat: 51.504, lon: -0.1249, name: "Ministry of Defence Main Building, London", country: "GB" };

export const UK_DEFENCE_FEEDS: AgencyFeed[] = [
  {
    id: "mod",
    name: "UK Ministry of Defence",
    prefix: "UK MOD",
    alias: /\b(MOD|Ministry of Defence|Defence Secretary|UK|British|Britain)\b/,
    url: "https://www.gov.uk/search/news-and-communications.atom?organisations%5B%5D=ministry-of-defence&order=updated-newest",
    place: MOD,
    basis: "UK Government department (Ministry of Defence) on GOV.UK (OGL v3)",
  },
];

export function ukDefenceKind(title: string): { type: "CONFLICT" | "BUSINESS" | "POLITICS"; subtype: string } {
  if (/\b(contracts?|industry|shipbuilding|procure(ment)?|jobs|factory|fabrication|order(s|ed)?|£\s?\d)/i.test(title)) return { type: "BUSINESS", subtype: "defence industry" };
  if (/\b(deploy(s|ed|ment)?|troops|strike[sd]?|missiles?|drones?|air defence|warship|frigate|destroyer|submarine|jets?|RAF|Royal Navy|exercise|patrol|Ukraine|Russia|intercept)/i.test(title)) return { type: "CONFLICT", subtype: "military activity" };
  return { type: "POLITICS", subtype: "defence policy" };
}

export const ukDefenceSpec: AgencySpec<AgencyFeed> = {
  dataSourceId: "uk-defence",
  feeds: UK_DEFENCE_FEEDS,
  maxAgeMs: 7 * 86_400_000,
  maxItemsPerFeed: 40,
  classify: ({ title }) => {
    // Recruitment, awards and heritage stories are not world events.
    if (/\b(medals?|honou?r(s|ed)?|award(s|ed)?|anniversary|commemorat|remembrance|recruit(s|ment)?|apprentice|cadets?|veterans? (card|scheme))\b/i.test(title)) return null;
    const k = ukDefenceKind(title);
    return { ...k, located: headlinePlace(title, "GB", "the UK Ministry of Defence") };
  },
};

export const ukDefenceConnector = agencyConnector(ukDefenceSpec, {
  name: "UK Ministry of Defence",
  description: "UK Ministry of Defence news and communications (GOV.UK), last 7 days; placed in a country the headline names, else at the MOD in London.",
  homepage: "https://www.gov.uk/government/organisations/ministry-of-defence",
  attribution: "UK Ministry of Defence via GOV.UK — Open Government Licence v3.0",
  categories: ["CONFLICT", "POLITICS", "BUSINESS"],
  refreshIntervalMs: 30 * 60_000,
});
