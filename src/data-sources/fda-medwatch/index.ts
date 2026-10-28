/**
 * FDA MedWatch safety alerts RSS (keyless): drug and device safety communications, medical
 * device early alerts and firm-announced recalls as FDA posts them. Complements `fda-recalls`
 * (openFDA Class I enforcement reports, which arrive later and are classified). Placed at FDA
 * headquarters, Silver Spring, MD.
 */
import { HQ } from "../official-common";
import { agencyConnector, type AgencyFeed, type AgencySpec } from "../agency-feeds/common";

export const MEDWATCH_FEEDS: AgencyFeed[] = [
  {
    id: "medwatch",
    name: "U.S. FDA — MedWatch safety alerts",
    prefix: "FDA MedWatch",
    alias: /\bFDA\b/,
    url: "https://www.fda.gov/about-fda/contact-fda/stay-informed/rss-feeds/medwatch/rss.xml",
    place: HQ.fda,
    basis: "U.S. federal agency (Food and Drug Administration)",
  },
];

export function medwatchSubtype(title: string, link: string): string {
  if (/^Early Alert\b/i.test(title) || /early-alert/i.test(link)) return "device early alert";
  if (/\b(recall|removes?|removal|correction|withdraw)/i.test(title)) return /\bmedical-devices?\b/i.test(link) ? "device recall" : "product recall";
  if (/\b(safety communication|warns?|warning|boxed warning|label change)\b/i.test(title)) return "safety communication";
  return "safety alert";
}

export const medwatchSpec: AgencySpec<AgencyFeed> = {
  dataSourceId: "fda-medwatch",
  feeds: MEDWATCH_FEEDS,
  maxAgeMs: 21 * 86_400_000,
  classify: ({ title, link }) => {
    const subtype = medwatchSubtype(title, link);
    return { type: "HEALTH", subtype, metrics: { veterinary: /\bveterinary|animal\b/i.test(title) } };
  },
};

export const fdaMedwatchConnector = agencyConnector(medwatchSpec, {
  name: "FDA MedWatch alerts",
  description: "FDA MedWatch safety alerts: drug/device safety communications, device early alerts and firm recalls (last 21 days).",
  homepage: "https://www.fda.gov/safety/medwatch-fda-safety-information-and-adverse-event-reporting-program",
  attribution: "U.S. Food and Drug Administration — public domain; not medical advice, follow the linked notice",
  categories: ["HEALTH"],
  refreshIntervalMs: 60 * 60_000,
});
