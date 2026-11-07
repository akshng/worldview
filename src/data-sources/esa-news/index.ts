/**
 * European Space Agency "Space News" RSS (keyless): launches, mission milestones, science
 * results and agreements, last 7 days. Europe's counterpart to `nasa-news`. Shown at the ESA
 * establishment a headline names (ESOC, ESTEC, ESRIN, ESAC, Kourou), else ESA Headquarters
 * in Paris. Media-accreditation and event-invitation notices are skipped.
 */
import { agencyConnector, type AgencyFeed, type AgencySpec, type Located } from "../agency-feeds/common";

const ESA_HQ = { lat: 48.8483, lon: 2.3036, name: "ESA Headquarters, Paris, France", country: "FR" };

export const ESA_FEEDS: AgencyFeed[] = [
  {
    id: "top",
    name: "European Space Agency",
    alias: /\bESA\b|\bEuropean Space Agency\b/,
    prefix: "ESA",
    url: "https://www.esa.int/rssfeed/TopNews",
    place: ESA_HQ,
    basis: "European Space Agency (intergovernmental space agency; official news)",
  },
];

export const ESA_SITES: Array<{ re: RegExp; name: string; lat: number; lon: number; country: string }> = [
  { re: /\bESOC\b|\bmission control\b.*\bDarmstadt\b|\bDarmstadt\b/i, name: "ESA ESOC, Darmstadt, Germany", lat: 49.8711, lon: 8.6224, country: "DE" },
  { re: /\bESTEC\b|\bNoordwijk\b/i, name: "ESA ESTEC, Noordwijk, Netherlands", lat: 52.2181, lon: 4.4199, country: "NL" },
  { re: /\bESRIN\b|\bFrascati\b/i, name: "ESA ESRIN, Frascati, Italy", lat: 41.8277, lon: 12.6744, country: "IT" },
  { re: /\bESAC\b|\bVillanueva de la Ca[nñ]ada\b/i, name: "ESA ESAC, Villanueva de la Cañada, Spain", lat: 40.4436, lon: -3.9525, country: "ES" },
  { re: /\bKourou\b|\bEurope's Spaceport\b|\bGuiana Space Centre\b|\bAriane ?6\b.*\blaunch|\bVega[- ]C\b.*\blaunch/i, name: "Europe's Spaceport, Kourou, French Guiana", lat: 5.2394, lon: -52.7685, country: "GF" },
];

export function esaSite(title: string): Located | null {
  const s = ESA_SITES.find((x) => x.re.test(title));
  return s ? { lat: s.lat, lon: s.lon, name: s.name, country: s.country, precision: "city", note: ` Shown at ${s.name}, which the headline points to.` } : null;
}

const SPACEFLIGHT = /\b(launch\w*|Ariane|Vega|mission|spacecraft|space station|ISS|Moon|lunar|Mars|astronauts?|crew|rocket|satellites?|orbit\w*|probe|telescope|Euclid|Gaia|JUICE|Hera|Plato|Sentinel|Copernicus|asteroid|comet|planet\w*|solar|Sun|space debris|reentry|re-entry)\b/i;
const ROUTINE = /\b(media (are )?invited|media accreditation|call for media|register (now|for)|webinar|livestream schedule|ESA Impact|week in images|image of the week)\b/i;

export const esaSpec: AgencySpec<AgencyFeed> = {
  dataSourceId: "esa-news",
  feeds: ESA_FEEDS,
  maxAgeMs: 7 * 86_400_000,
  classify: ({ title }) => {
    if (ROUTINE.test(title)) return null;
    const subtype = /\b(contracts?|signs?|agreement|partnership)\b/i.test(title) ? "ESA agreement" : /\blaunch\w*\b/i.test(title) ? "ESA launch" : "ESA news";
    return { type: SPACEFLIGHT.test(title) ? "SPACE" : "SCIENCE", subtype, located: esaSite(title) };
  },
};

export const esaNewsConnector = agencyConnector(esaSpec, {
  name: "ESA space news",
  description: "European Space Agency news (launches, missions, science, agreements), last 7 days; at the ESA site a headline names, else ESA HQ Paris.",
  homepage: "https://www.esa.int/",
  attribution: "European Space Agency — esa.int RSS; headline, short excerpt and link only",
  sourceType: "OFFICIAL_AGENCY",
  categories: ["SPACE", "SCIENCE"],
  refreshIntervalMs: 60 * 60_000,
});
