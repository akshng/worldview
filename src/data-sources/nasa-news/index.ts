/**
 * NASA news releases RSS (keyless): mission milestones, contract awards, agreements, science
 * results. Shown at the NASA field centre the headline names (Kennedy, Johnson, JPL, …),
 * else NASA Headquarters in Washington.
 */
import { agencyConnector, type AgencyFeed, type AgencySpec, type Located } from "../agency-feeds/common";

const NASA_HQ = { lat: 38.883, lon: -77.0163, name: "NASA Headquarters, Washington, DC", country: "US" };

export const NASA_FEEDS: AgencyFeed[] = [
  {
    id: "releases",
    name: "NASA",
    alias: /\bNASA\b/,
    url: "https://www.nasa.gov/news-release/feed/",
    place: NASA_HQ,
    basis: "U.S. federal space agency (official news releases)",
  },
];

/** A centre name only counts with a locative cue or the facility word ("at Kennedy", "Johnson Space Center"). */
const center = (n: string) => new RegExp(`\\b(?:at|to|from|NASA|NASA's|in) ${n}\\b|\\b${n}(?:'s)? (?:Space|Research|Flight|Center|Assembly|Laboratory)\\b`);

/** NASA field centres, matched on the names NASA uses in headlines. */
export const NASA_CENTERS: Array<{ re: RegExp; name: string; lat: number; lon: number }> = [
  { re: center("Kennedy"), name: "NASA Kennedy Space Center, Florida", lat: 28.5729, lon: -80.649 },
  { re: center("Johnson"), name: "NASA Johnson Space Center, Houston, Texas", lat: 29.5593, lon: -95.09 },
  { re: /\b(JPL|Jet Propulsion Laboratory)\b/, name: "NASA Jet Propulsion Laboratory, Pasadena, California", lat: 34.2013, lon: -118.1714 },
  { re: center("Goddard"), name: "NASA Goddard Space Flight Center, Greenbelt, Maryland", lat: 38.9917, lon: -76.8526 },
  { re: center("Marshall"), name: "NASA Marshall Space Flight Center, Huntsville, Alabama", lat: 34.6466, lon: -86.6739 },
  { re: center("Ames"), name: "NASA Ames Research Center, Moffett Field, California", lat: 37.4089, lon: -122.0644 },
  { re: center("Langley"), name: "NASA Langley Research Center, Hampton, Virginia", lat: 37.0855, lon: -76.3803 },
  { re: center("Glenn"), name: "NASA Glenn Research Center, Cleveland, Ohio", lat: 41.4132, lon: -81.8618 },
  { re: center("Armstrong"), name: "NASA Armstrong Flight Research Center, Edwards, California", lat: 34.9555, lon: -117.8855 },
  { re: center("Stennis"), name: "NASA Stennis Space Center, Mississippi", lat: 30.3632, lon: -89.6005 },
  { re: center("Wallops"), name: "NASA Wallops Flight Facility, Virginia", lat: 37.9402, lon: -75.4664 },
  { re: center("Michoud"), name: "NASA Michoud Assembly Facility, New Orleans, Louisiana", lat: 30.0254, lon: -89.9138 },
];

export function nasaCenter(title: string): Located | null {
  const c = NASA_CENTERS.find((x) => x.re.test(title));
  return c ? { lat: c.lat, lon: c.lon, name: c.name, country: "US", precision: "city", note: ` Shown at ${c.name}, which the headline names.` } : null;
}

const SPACEFLIGHT = /\b(launch|Artemis|SLS|Orion|mission|spacecraft|space station|ISS|Moon|lunar|Mars|astronauts?|crew|rocket|satellite|orbit|probe|telescope|Webb|Hubble|asteroid|comet|planet|solar system)\b/i;

/** The feed is site-wide: image-of-the-day posts, blogs and media advisories are not news events. */
const ROUTINE_LINK = /\/(image-article|image-detail|blogs?|earth-observatory|podcasts?|video|gallery)\//i;
const ROUTINE_TITLE = /^(NASA )?(Invites Media|Sets Coverage|to Provide Coverage)|\bMedia Accreditation\b|^APOD:/i;

export const nasaSpec: AgencySpec<AgencyFeed> = {
  dataSourceId: "nasa-news",
  feeds: NASA_FEEDS,
  maxAgeMs: 7 * 86_400_000,
  classify: ({ title, link }) => {
    if (ROUTINE_LINK.test(link) || ROUTINE_TITLE.test(title)) return null;
    const subtype = /\b(contract|awards?|selects? .* (company|firm|provider))\b/i.test(title)
      ? "NASA contract"
      : /\b(Accords|agreement|partnership|signatory)\b/i.test(title)
        ? "NASA agreement"
        : "NASA news release";
    return { type: SPACEFLIGHT.test(title) ? "SPACE" : "SCIENCE", subtype, located: nasaCenter(title) };
  },
};

export const nasaNewsConnector = agencyConnector(nasaSpec, {
  name: "NASA news releases",
  description: "NASA news releases (missions, contracts, agreements, science), last 7 days; at the field centre a headline names, else NASA HQ.",
  homepage: "https://www.nasa.gov/news/",
  attribution: "NASA — nasa.gov RSS; NASA material is generally not copyrighted (see NASA media usage guidelines)",
  sourceType: "OFFICIAL_AGENCY",
  categories: ["SPACE", "SCIENCE"],
  refreshIntervalMs: 30 * 60_000,
});
