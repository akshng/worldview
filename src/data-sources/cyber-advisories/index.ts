/**
 * Government cybersecurity advisories (keyless RSS): CISA cybersecurity advisories (joint
 * advisories, #StopRansomware) and CISA alerts, CERT-EU security advisories, and UK NCSC news
 * and reports (blogs and guidance pages skipped). Routine "CISA adds … Known Exploited
 * Vulnerabilities" alerts are skipped — the Security panel reads the KEV catalogue directly.
 * Shown at the issuer's headquarters, or in a foreign country the headline names.
 */
import { agencyConnector, fetchAgencyFeeds, headlinePlace, type AgencyFeed, type AgencyFeedsRaw, type AgencySpec } from "../agency-feeds/common";
import type { FetchContext } from "../types";

const CISA_HQ = { lat: 38.8794, lon: -77.0144, name: "CISA, Arlington, VA", country: "US" };
const CERT_EU = { lat: 50.8427, lon: 4.3826, name: "CERT-EU, Brussels", country: "BE" };
const NCSC = { lat: 51.5005, lon: -0.1246, name: "National Cyber Security Centre, London", country: "GB" };

export interface CyberFeed extends AgencyFeed {
  home: string;
}

export const CYBER_FEEDS: CyberFeed[] = [
  { id: "cisa-advisories", name: "CISA — cybersecurity advisories", prefix: "CISA", alias: /\b(CISA|#StopRansomware)\b/i, url: "https://www.cisa.gov/cybersecurity-advisories/cybersecurity-advisories.xml", place: CISA_HQ, home: "US", basis: "U.S. federal agency (Cybersecurity and Infrastructure Security Agency)" },
  { id: "cisa-alerts", name: "CISA — alerts", prefix: "CISA", alias: /\bCISA\b/, url: "https://www.cisa.gov/cybersecurity-advisories/alerts.xml", place: CISA_HQ, home: "US", basis: "U.S. federal agency (Cybersecurity and Infrastructure Security Agency)" },
  { id: "cert-eu", name: "CERT-EU — security advisories", prefix: "CERT-EU", alias: /\bCERT-EU\b/, url: "https://cert.europa.eu/publications/security-advisories-rss", place: CERT_EU, home: "BE", basis: "Cybersecurity Service for the Union institutions, bodies, offices and agencies (CERT-EU)" },
  { id: "ncsc-uk", name: "UK National Cyber Security Centre", prefix: "NCSC", alias: /\bNCSC\b/, url: "https://www.ncsc.gov.uk/api/1/services/v1/all-rss-feed.xml", place: NCSC, home: "GB", basis: "UK government agency (National Cyber Security Centre, part of GCHQ)" },
];

/**
 * CERT-EU prints "Fri, 23 Oct 2026 16:36:26 CEST", which Date.parse rejects; rewrite the
 * European zone abbreviations as offsets.
 */
export function normalizeZone(s: string | null): string | null {
  if (!s) return s;
  return s.trim().replace(/\s(CEST)$/, " +0200").replace(/\s(CET)$/, " +0100").replace(/\s(BST)$/, " +0100");
}

export function cyberSubtype(feedId: string, title: string): string | null {
  if (/known exploited vulnerabilit/i.test(title)) return null;
  if (/#?StopRansomware|ransomware/i.test(title)) return "ransomware advisory";
  if (/\b(state|government)[- ]?(linked|sponsored|backed)|\b(China|Chinese|PRC|Russia|Russian|Iran|Iranian|North Korea|DPRK)\b.*\b(actors?|hackers?|APT|cyber)/i.test(title)) return "state-sponsored threat";
  if (/\b(critical|zero-day|0-day|actively exploited|exploitation|vulnerabilit(y|ies)|RCE)\b/i.test(title)) return "vulnerability advisory";
  if (/\b(incident|breach|attack|outage|disruptive)\b/i.test(title)) return "cyber incident";
  if (feedId === "cisa-advisories") return "joint advisory";
  return "cyber advisory";
}

export const cyberSpec: AgencySpec<CyberFeed> = {
  dataSourceId: "cyber-advisories",
  feeds: CYBER_FEEDS,
  maxAgeMs: 21 * 86_400_000,
  maxItemsPerFeed: 30,
  classify: ({ feed, title, link }) => {
    // NCSC's feed mixes blogs, guidance and training pages; keep news and reports.
    if (feed.id === "ncsc-uk" && !/ncsc\.gov\.uk\/(news|report)\//.test(link)) return null;
    const subtype = cyberSubtype(feed.id, title);
    if (!subtype) return null;
    // A state actor's country is the attacker, not where the event happens: keep those at the issuer.
    const located = subtype === "state-sponsored threat" ? null : headlinePlace(title, feed.home, feed.name);
    return { type: "TECHNOLOGY", subtype, located, metrics: { issuer: feed.prefix ?? feed.name } };
  },
};

export async function fetchCyber(ctx: FetchContext): Promise<AgencyFeedsRaw> {
  const raw = await fetchAgencyFeeds(ctx, CYBER_FEEDS, 30);
  return { feeds: raw.feeds.map((f) => ({ ...f, items: f.items.map((it) => ({ ...it, published: normalizeZone(it.published) })) })) };
}

export const cyberAdvisoriesConnector = {
  ...agencyConnector(cyberSpec, {
    name: "Cybersecurity advisories (CISA, CERT-EU, NCSC)",
    description: "CISA cybersecurity advisories and alerts, CERT-EU security advisories and UK NCSC news/reports from the last 21 days (KEV catalogue additions skipped).",
    homepage: "https://www.cisa.gov/news-events/cybersecurity-advisories",
    attribution: "CISA (public domain U.S. government); CERT-EU (© European Union, reuse with attribution); NCSC (Open Government Licence v3.0)",
    categories: ["TECHNOLOGY"],
    refreshIntervalMs: 60 * 60_000,
  }),
  fetch: fetchCyber,
};
