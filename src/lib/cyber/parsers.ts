/** Pure parsers for the security dashboard (no I/O — see ./index.ts). */
import type { EventCandidateInput } from "@/types/events";
import { safeUrl } from "@/data-sources/types";

export interface KevEntry {
  cveId: string;
  vendor: string;
  product: string;
  name: string;
  description: string;
  dateAdded: string;
  /** Federal civilian agencies' remediation deadline (BOD 22-01 / successors) */
  dueDate: string | null;
  /** CISA's knownRansomwareCampaignUse === "Known" */
  ransomware: boolean;
  url: string;
}

export interface KevSummary {
  catalogVersion: string | null;
  dateReleased: string | null;
  total: number;
  addedLast7d: number;
  addedLast30d: number;
  /** Most recent additions, newest first */
  latest: KevEntry[];
}

interface KevJson {
  catalogVersion?: string;
  dateReleased?: string;
  vulnerabilities?: Array<{
    cveID?: string;
    vendorProject?: string;
    product?: string;
    vulnerabilityName?: string;
    shortDescription?: string;
    dateAdded?: string;
    dueDate?: string;
    knownRansomwareCampaignUse?: string;
  }>;
}

const CVE_RE = /^CVE-\d{4}-\d{4,}$/;
const nvdLink = (id: string) => `https://nvd.nist.gov/vuln/detail/${id}`;

/** CISA KEV catalog → summary of recent additions plus the set of all listed CVE ids. */
export function parseKev(j: KevJson, now: number, limit = 25): { summary: KevSummary; ids: Set<string> } {
  const rows = (j.vulnerabilities ?? []).filter((v) => typeof v.cveID === "string" && CVE_RE.test(v.cveID) && /^\d{4}-\d{2}-\d{2}$/.test(v.dateAdded ?? ""));
  const since = (days: number) => rows.filter((v) => now - Date.parse(`${v.dateAdded}T00:00:00Z`) <= days * 86_400_000).length;
  const latest = [...rows]
    .sort((a, b) => b.dateAdded!.localeCompare(a.dateAdded!) || b.cveID!.localeCompare(a.cveID!))
    .slice(0, limit)
    .map((v) => ({
      cveId: v.cveID!,
      vendor: v.vendorProject?.trim() ?? "",
      product: v.product?.trim() ?? "",
      name: v.vulnerabilityName?.trim() ?? v.cveID!,
      description: v.shortDescription?.trim() ?? "",
      dateAdded: v.dateAdded!,
      dueDate: /^\d{4}-\d{2}-\d{2}$/.test(v.dueDate ?? "") ? v.dueDate! : null,
      ransomware: v.knownRansomwareCampaignUse?.toLowerCase() === "known",
      url: nvdLink(v.cveID!),
    }));
  return {
    summary: { catalogVersion: j.catalogVersion ?? null, dateReleased: j.dateReleased ?? null, total: rows.length, addedLast7d: since(7), addedLast30d: since(30), latest },
    ids: new Set(rows.map((v) => v.cveID!)),
  };
}

export interface NvdCve {
  id: string;
  published: string;
  score: number;
  severity: string;
  vector: string | null;
  vendor: string | null;
  product: string | null;
  description: string;
  url: string;
  /** Also in CISA's Known Exploited Vulnerabilities catalog */
  knownExploited: boolean;
}

interface CvssMetric {
  type?: string;
  cvssData?: { baseScore?: number; baseSeverity?: string; vectorString?: string };
}
interface NvdJson {
  vulnerabilities?: Array<{
    cve?: {
      id?: string;
      published?: string;
      vulnStatus?: string;
      descriptions?: Array<{ lang?: string; value?: string }>;
      affected?: Array<{ affectedData?: Array<{ vendor?: string; product?: string }> }>;
      metrics?: { cvssMetricV31?: CvssMetric[]; cvssMetricV30?: CvssMetric[] };
    };
  }>;
}

/** NVD timestamps are UTC without a zone designator. */
const nvdTime = (s: string) => (/[zZ]|[+-]\d{2}:?\d{2}$/.test(s) ? s : `${s}Z`);

/** NVD CVE API 2.0 response → critical CVEs (CVSS v3 primary score preferred), newest first. */
export function parseNvd(j: NvdJson): NvdCve[] {
  const out: NvdCve[] = [];
  for (const v of j.vulnerabilities ?? []) {
    const c = v.cve;
    if (!c?.id || !CVE_RE.test(c.id) || !c.published || c.vulnStatus === "Rejected") continue;
    const metrics = [...(c.metrics?.cvssMetricV31 ?? []), ...(c.metrics?.cvssMetricV30 ?? [])];
    const m = metrics.find((x) => x.type === "Primary") ?? metrics[0];
    const score = m?.cvssData?.baseScore;
    if (typeof score !== "number") continue;
    const published = new Date(nvdTime(c.published));
    if (Number.isNaN(published.getTime())) continue;
    const affected = c.affected?.flatMap((a) => a.affectedData ?? []).find((a) => a.vendor || a.product);
    const clean = (s: string | undefined) => (s && !/^n\/?a$/i.test(s.trim()) ? s.trim() : null);
    out.push({
      id: c.id,
      published: published.toISOString(),
      score,
      severity: m?.cvssData?.baseSeverity ?? "",
      vector: m?.cvssData?.vectorString ?? null,
      vendor: clean(affected?.vendor),
      product: clean(affected?.product),
      description: (c.descriptions?.find((d) => d.lang === "en")?.value ?? "").replace(/\s+/g, " ").trim().slice(0, 500),
      url: nvdLink(c.id),
      knownExploited: false,
    });
  }
  return out.sort((a, b) => b.published.localeCompare(a.published) || b.score - a.score);
}

export interface AdvisoryChange {
  government: "US" | "UK" | "CA" | "AU";
  /** Destination country code */
  country: string | null;
  place: string;
  /** Advice as the government words it */
  advice: string;
  updatedAt: string;
  url: string | null;
}

const GOV_BY_SOURCE: Record<string, AdvisoryChange["government"]> = { "travel-advisories": "US", "fcdo-travel": "UK", "canada-travel": "CA", smartraveller: "AU" };

/** Travel-advisory event candidates → panel rows, newest first. */
export function advisoryChanges(candidates: EventCandidateInput[]): AdvisoryChange[] {
  const out: AdvisoryChange[] = [];
  for (const c of candidates) {
    const government = GOV_BY_SOURCE[c.source.dataSourceId];
    if (!government || c.subtype !== "travel advisory") continue;
    // Titles are "<Gov> travel advisory|advice: <Place> — <Advice>".
    const m = c.title.match(/^[^:]+:\s*(.+?)\s+—\s+(.+)$/);
    out.push({
      government,
      country: c.country ?? null,
      place: m?.[1] ?? c.locationName ?? c.country ?? "",
      advice: m?.[2] ?? c.title,
      updatedAt: c.timestamp,
      url: safeUrl(c.source.sourceUrl),
    });
  }
  return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
