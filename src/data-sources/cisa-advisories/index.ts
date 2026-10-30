/**
 * CISA cybersecurity advisories (keyless RSS): alerts, joint cybersecurity advisories, ICS and
 * ICS-medical advisories, and Known Exploited Vulnerabilities catalog additions. Placed at CISA
 * headquarters, Arlington, VA — the products describe software, not places.
 */
import { agencyConnector, type AgencyFeed, type AgencySpec, type FeedItemView } from "../agency-feeds/common";

const CISA_HQ = { lat: 38.8823, lon: -77.1146, name: "CISA, Arlington, VA", country: "US" };

export const CISA_FEEDS: AgencyFeed[] = [
  {
    id: "advisories",
    name: "CISA",
    alias: /\bCISA\b/,
    url: "https://www.cisa.gov/cybersecurity-advisories/all.xml",
    place: CISA_HQ,
    basis: "U.S. federal agency (Cybersecurity and Infrastructure Security Agency)",
  },
];

/** CVE ids named in a text, de-duplicated, in order. */
export function cveIds(text: string): string[] {
  return [...new Set((text.match(/\bCVE-\d{4}-\d{4,7}\b/gi) ?? []).map((s) => s.toUpperCase()))];
}

export function cisaSubtype({ title, link }: Pick<FeedItemView, "title" | "link">): string {
  if (/known exploited vulnerabilit/i.test(title)) return "KEV addition";
  if (/\/ics-medical-advisories\//i.test(link)) return "ICS medical advisory";
  if (/\/ics-advisories\//i.test(link)) return "ICS advisory";
  if (/\/cybersecurity-advisories\/aa\d/i.test(link)) return "cybersecurity advisory";
  if (/\/analysis-reports\//i.test(link)) return "malware analysis report";
  if (/\/alerts\//i.test(link)) return "alert";
  return "cybersecurity advisory";
}

export const cisaSpec: AgencySpec<AgencyFeed> = {
  dataSourceId: "cisa-advisories",
  feeds: CISA_FEEDS,
  maxAgeMs: 7 * 86_400_000,
  maxItemsPerFeed: 100,
  classify: (v) => {
    const subtype = cisaSubtype(v);
    const cves = cveIds(`${v.title} ${v.description}`);
    const advisoryId = v.link.match(/\/(icsm?a-\d{2}-\d{3}-\d{2}|aa\d{2}-\d{3}[a-z]?)\b/i)?.[1]?.toUpperCase() ?? null;
    return {
      type: "TECHNOLOGY",
      subtype,
      metrics: { advisory_id: advisoryId, cves: cves.length ? cves.slice(0, 20).join(", ") : null, cve_count: cves.length || null },
      extra: cves.length ? `CVEs named: ${cves.slice(0, 8).join(", ")}${cves.length > 8 ? ` and ${cves.length - 8} more` : ""}.` : undefined,
    };
  },
};

export const cisaAdvisoriesConnector = agencyConnector(cisaSpec, {
  name: "CISA cybersecurity advisories",
  description: "CISA alerts, joint cybersecurity advisories, ICS advisories and Known Exploited Vulnerabilities additions from the last 7 days.",
  homepage: "https://www.cisa.gov/news-events/cybersecurity-advisories",
  attribution: "Cybersecurity and Infrastructure Security Agency — U.S. government work, public domain; link back to each advisory",
  categories: ["TECHNOLOGY"],
  refreshIntervalMs: 30 * 60_000,
});
