/**
 * U.S. Department of Justice Office of Public Affairs press releases RSS (keyless). Only major
 * cases are kept: corporate and financial cases (antitrust, securities, sanctions/export
 * evasion, bribery, money laundering, crypto, settlements, or $10M+ at stake) and national
 * security cases (espionage, terrorism, foreign agents, cyber intrusions). Routine individual
 * cases are skipped. Placed in a non-US country or a US state the headline names, else at
 * DOJ headquarters (Robert F. Kennedy Building, Washington).
 */
import { agencyConnector, headlinePlace, headlineUsState, maxDollarAmount, type AgencyFeed, type AgencySpec } from "../agency-feeds/common";

const DOJ_HQ = { lat: 38.8933, lon: -77.025, name: "U.S. Department of Justice, Washington, DC", country: "US" };

export const DOJ_FEEDS: AgencyFeed[] = [
  {
    id: "opa",
    name: "U.S. Department of Justice",
    prefix: "DOJ",
    alias: /\b(Justice Department|Department of Justice|DOJ|Attorney General)\b/i,
    url: "https://www.justice.gov/news/rss?type=press_release&m=1",
    place: DOJ_HQ,
    basis: "U.S. federal department (Office of Public Affairs press releases)",
  },
];

const CORPORATE = /\b(antitrust|price[- ]fixing|bid[- ]rigging|cartel|monopol\w*|merger|acquisition|securities|insider trading|market manipulation|Ponzi|investment fraud|wire fraud conspiracy|bank fraud|money laundering|FCPA|Foreign Corrupt Practices|brib\w+|kickbacks?|crypto\w*|bitcoin|digital assets?|sanctions?|export controls?|smuggl\w+ .*(technology|chips?|weapons|arms)|tariffs?|customs duties|False Claims Act|agrees? to pay|to pay \$|settle\w*|resolve[sd]? .*(allegations|investigation)|deferred prosecution|plea agreement|corporation|company|companies|Inc\.|LLC|Ltd\.?|Corp\.?|bank)\b/i;
const NATSEC = /\b(espionage|spy(ing)?|terror\w*|ISIS|al[- ]Qaeda|Hezbollah|Hamas|material support|national security|foreign agents?|agent of (a )?foreign|unregistered agent|classified|(People's Republic of )?China|Chinese government|Iran\w*|North Korea\w*|Russia\w*|cartel|hack\w*|cyber\w*|ransomware|botnet)\b/i;
const MAJOR_USD = 10_000_000;

export function dojCaseKind(title: string): "national security" | "corporate" | null {
  if (NATSEC.test(title)) return "national security";
  const usd = maxDollarAmount(title);
  if (CORPORATE.test(title) || (usd !== null && usd >= MAJOR_USD)) return "corporate";
  return null;
}

export const dojSpec: AgencySpec<AgencyFeed> = {
  dataSourceId: "doj-press",
  feeds: DOJ_FEEDS,
  maxAgeMs: 7 * 86_400_000,
  classify: ({ title }) => {
    const kind = dojCaseKind(title);
    if (!kind) return null;
    const located = headlinePlace(title, "US", "the U.S. Department of Justice") ?? headlineUsState(title, "the U.S. Department of Justice");
    return {
      type: kind === "corporate" ? "BUSINESS" : "POLITICS",
      subtype: kind === "corporate" ? "corporate/financial case" : "national security case",
      metrics: { amount_usd: maxDollarAmount(title) },
      located,
      extra: /\b(charged|charges|indicted|indictment|arrested|accused|complaint)\b/i.test(title) ? "Charges are allegations; defendants are presumed innocent unless proven guilty." : undefined,
    };
  },
};

export const dojPressConnector = agencyConnector(dojSpec, {
  name: "DOJ press releases (major cases)",
  description: "U.S. Department of Justice press releases on corporate/financial ($10M+, antitrust, sanctions, bribery, crypto) and national-security cases, last 7 days.",
  homepage: "https://www.justice.gov/news",
  attribution: "U.S. Department of Justice — public domain; charges are allegations, defendants are presumed innocent until proven guilty",
  categories: ["BUSINESS", "POLITICS"],
  refreshIntervalMs: 30 * 60_000,
});
