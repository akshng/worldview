/**
 * Security dashboard from free, keyless official sources:
 *   - CISA Known Exploited Vulnerabilities catalog (JSON)
 *   - NIST NVD CVE API 2.0 — critical CVEs published in the last 7 days (one request, rate-limited upstream)
 *   - Travel-advisory changes from the US, UK, Canadian and Australian governments
 *     (the same connectors that put advisories on the map)
 * Cached 1 hour as a whole; parsers are pure and unit-tested.
 */
import "server-only";
import { userAgent } from "@/lib/env";
import type { DataSourceConnector } from "@/data-sources/types";
import { travelAdvisoriesConnector } from "@/data-sources/travel-advisories";
import { fcdoTravelConnector } from "@/data-sources/fcdo-travel";
import { canadaTravelConnector } from "@/data-sources/canada-travel";
import { smartravellerConnector } from "@/data-sources/smartraveller";
import { advisoryChanges, parseKev, parseNvd, type AdvisoryChange, type KevSummary, type NvdCve } from "./parsers";

export * from "./parsers";

export interface SecurityDashboard {
  kev: KevSummary | null;
  cves: NvdCve[];
  /** Window the CVE list covers */
  cveWindowDays: number;
  advisories: AdvisoryChange[];
  generatedAt: string;
  failed: string[];
}

const KEV_URL = "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json";
const NVD_URL = "https://services.nvd.nist.gov/rest/json/cves/2.0";
const CVE_WINDOW_DAYS = 7;

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: { "User-Agent": userAgent(), Accept: "application/json" }, signal: AbortSignal.timeout(45_000), cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** NVD wants ISO-8601 with milliseconds; the range may span at most 120 days. */
export function nvdUrl(now: number, days = CVE_WINDOW_DAYS): string {
  const iso = (t: number) => new Date(t).toISOString();
  const q = new URLSearchParams({ pubStartDate: iso(now - days * 86_400_000), pubEndDate: iso(now), cvssV3Severity: "CRITICAL", resultsPerPage: "200" });
  return `${NVD_URL}?${q}`;
}

const TRAVEL = [travelAdvisoriesConnector, fcdoTravelConnector, canadaTravelConnector, smartravellerConnector] as unknown as DataSourceConnector<unknown>[];

async function load(): Promise<SecurityDashboard> {
  const now = Date.now();
  const failed: string[] = [];
  const [kevR, nvdR, ...travelR] = await Promise.allSettled([
    getJson(KEV_URL),
    getJson(nvdUrl(now)),
    ...TRAVEL.map(async (c) => {
      const raw = await c.fetch({ signal: AbortSignal.timeout(c.timeoutMs ?? 60_000), lastSuccessAt: null, now, userAgent: userAgent(), env: {} });
      return c.parse(raw, { now, retrievedAt: new Date(now).toISOString() }).candidates;
    }),
  ]);
  let kev: KevSummary | null = null;
  let kevIds = new Set<string>();
  if (kevR.status === "fulfilled") ({ summary: kev, ids: kevIds } = parseKev(kevR.value as Parameters<typeof parseKev>[0], now));
  else failed.push("CISA KEV");
  let cves: NvdCve[] = [];
  if (nvdR.status === "fulfilled") cves = parseNvd(nvdR.value as Parameters<typeof parseNvd>[0]);
  else failed.push("NVD");
  cves = cves.map((c) => ({ ...c, knownExploited: kevIds.has(c.id) }));
  const candidates = travelR.flatMap((r, i) => {
    if (r.status === "fulfilled") return r.value;
    failed.push(TRAVEL[i].name);
    return [];
  });
  return {
    kev,
    cves,
    cveWindowDays: CVE_WINDOW_DAYS,
    advisories: advisoryChanges(candidates).slice(0, 150),
    generatedAt: new Date(now).toISOString(),
    failed,
  };
}

const TTL = 60 * 60_000;
const g = globalThis as unknown as { __worldviewCyber?: { at: number; value: SecurityDashboard }; __worldviewCyberLoading?: Promise<SecurityDashboard> };

export async function getSecurityDashboard(): Promise<SecurityDashboard> {
  const hit = g.__worldviewCyber;
  if (hit && Date.now() - hit.at < TTL) return hit.value;
  // One upstream load at a time (NVD is rate-limited for keyless clients).
  g.__worldviewCyberLoading ??= load().finally(() => {
    g.__worldviewCyberLoading = undefined;
  });
  const value = await g.__worldviewCyberLoading;
  const usable = value.kev || value.cves.length || value.advisories.length;
  // Keep the last good result if everything failed this time.
  if (usable || !hit) g.__worldviewCyber = { at: usable ? Date.now() : Date.now() - TTL + 5 * 60_000, value };
  return g.__worldviewCyber?.value ?? value;
}
