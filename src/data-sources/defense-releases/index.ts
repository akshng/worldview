/**
 * U.S. Department of War (formerly Defense) official RSS feeds (war.gov; defense.gov redirects
 * there), keyless: news releases (readouts, statements, announcements) and the daily contract
 * announcement digest (contracts valued at $7.5 million or more). Placed at the Pentagon.
 */
import { agencyConnector, type AgencyFeed, type AgencySpec } from "../agency-feeds/common";

const PENTAGON = { lat: 38.8719, lon: -77.0563, name: "The Pentagon, Arlington, VA", country: "US" };

export const DEFENSE_FEEDS: AgencyFeed[] = [
  {
    id: "releases",
    name: "U.S. Department of War",
    prefix: "Department of War",
    alias: /\b(Department of (War|Defense)|Pentagon|Secretary of (War|Defense)|DOW|DOD)\b/i,
    url: "https://www.war.gov/DesktopModules/ArticleCS/RSS.ashx?ContentType=9&Site=945&max=40",
    place: PENTAGON,
    basis: "U.S. federal department (official news releases)",
  },
  {
    id: "contracts",
    name: "U.S. Department of War — contracts",
    prefix: "Department of War",
    alias: /^Contracts for /i,
    url: "https://www.war.gov/DesktopModules/ArticleCS/RSS.ashx?ContentType=400&Site=945&max=10",
    place: PENTAGON,
    basis: "U.S. federal department (daily contract announcements, $7.5M+)",
  },
];

export function defenseSubtype(title: string): string {
  if (/^Readout\b/i.test(title)) return "readout";
  if (/^Statement\b|\bStatement (by|from|on)\b/i.test(title)) return "statement";
  if (/\b(Foreign Military Sales?|FMS)\b/i.test(title)) return "foreign military sale";
  if (/\b(nominat|appoint|general officer|flag officer|assignments?)\b/i.test(title)) return "personnel announcement";
  return "defense release";
}

export const defenseSpec: AgencySpec<AgencyFeed> = {
  dataSourceId: "defense-releases",
  feeds: DEFENSE_FEEDS,
  maxAgeMs: 7 * 86_400_000,
  classify: ({ feed, title }) => {
    if (feed.id === "contracts") {
      if (!/^Contracts for /i.test(title)) return null;
      return {
        type: "BUSINESS",
        subtype: "defense contracts",
        title: `Department of War contract announcements — ${title.replace(/^Contracts for /i, "")}`,
        extra: "The daily announcement lists contracts valued at $7.5 million or more; see the release for awardees and amounts.",
      };
    }
    return { type: "POLITICS", subtype: defenseSubtype(title) };
  },
};

export const defenseReleasesConnector = agencyConnector(defenseSpec, {
  name: "U.S. Department of War",
  description: "Department of War (Defense) news releases and daily contract announcements ($7.5M+), last 7 days, at the Pentagon.",
  homepage: "https://www.war.gov/News/Releases/",
  attribution: "U.S. Department of War — war.gov RSS (U.S. government work, public domain)",
  categories: ["POLITICS", "BUSINESS"],
  refreshIntervalMs: 30 * 60_000,
});
