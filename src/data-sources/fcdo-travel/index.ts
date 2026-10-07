/**
 * UK FCDO foreign travel advice (GOV.UK Content API, keyless). Destinations
 * updated in the last 30 days where the FCDO advises against all or all but
 * essential travel to the whole country or parts of it.
 *
 * The index lists every destination with its last-update time; the advice
 * status (`details.alert_status`) is only on each destination's own page, so
 * only recently updated pages are fetched, and unchanged ones are reused.
 */
import { findCountryByName } from "@/lib/geo/gazetteer";
import { placesInText } from "@/lib/geo/headline-places";
import type { EventCandidateInput } from "@/types/events";
import { httpGet, plainText, safeUrl, type DataSourceConnector, type FetchContext, type ParseContext, type ParseResult } from "../types";
import { advisoryCandidate, isRecent } from "../travel-advisories/common";

const API = "https://www.gov.uk/api/content/foreign-travel-advice";

export interface FcdoIndexChild {
  base_path?: string;
  title?: string;
  web_url?: string;
  public_updated_at?: string;
  details?: { change_description?: string; country?: { name?: string; slug?: string } };
}

export interface FcdoPage {
  slug: string;
  name: string;
  url: string | null;
  updatedAt: string;
  changeDescription: string | null;
  alertStatus: string[];
}

export interface FcdoRaw {
  pages: FcdoPage[];
}

/** Most to least severe. Values of GOV.UK `details.alert_status`. */
export const FCDO_STATUSES = [
  "avoid_all_travel_to_whole_country",
  "avoid_all_but_essential_travel_to_whole_country",
  "avoid_all_travel_to_parts",
  "avoid_all_but_essential_travel_to_parts",
] as const;

const STATUS_TEXT: Record<string, string> = {
  avoid_all_travel_to_whole_country: "all travel",
  avoid_all_but_essential_travel_to_whole_country: "all but essential travel",
  avoid_all_travel_to_parts: "all travel to parts",
  avoid_all_but_essential_travel_to_parts: "all but essential travel to parts",
};

/** Recently updated destinations from the index, newest first. */
export function recentFcdoChildren(index: { links?: { children?: FcdoIndexChild[] } }, now: number): FcdoIndexChild[] {
  return (index.links?.children ?? [])
    .filter((c) => c.details?.country?.slug && isRecent(c.public_updated_at ? new Date(c.public_updated_at) : null, now))
    .sort((a, b) => String(b.public_updated_at).localeCompare(String(a.public_updated_at)));
}

/** One destination's Content API document → the fields we keep. */
export function toFcdoPage(doc: {
  base_path?: string;
  title?: string;
  web_url?: string;
  public_updated_at?: string;
  details?: { alert_status?: string[]; change_description?: string; country?: { name?: string; slug?: string } };
}): FcdoPage | null {
  const slug = doc.details?.country?.slug ?? doc.base_path?.split("/").pop();
  const name = doc.details?.country?.name ?? doc.title?.replace(/\s+travel advice$/i, "");
  if (!slug || !name || !doc.public_updated_at) return null;
  return {
    slug,
    name,
    url: safeUrl(doc.web_url) ?? `https://www.gov.uk/foreign-travel-advice/${slug}`,
    updatedAt: doc.public_updated_at,
    changeDescription: doc.details?.change_description ?? null,
    alertStatus: Array.isArray(doc.details?.alert_status) ? doc.details.alert_status.filter((s): s is string => typeof s === "string") : [],
  };
}

/** "FCDO advises against all travel to parts of X and all but essential travel to other parts" */
export function describeFcdoStatus(place: string, statuses: string[]): string | null {
  const known = FCDO_STATUSES.filter((s) => statuses.includes(s));
  if (!known.length) return null;
  const whole = known.find((s) => s.endsWith("whole_country"));
  const parts = known.filter((s) => s.endsWith("parts"));
  const clauses: string[] = [];
  if (whole) clauses.push(`${STATUS_TEXT[whole]} to ${place}`);
  if (parts.length) {
    const what = parts.map((s) => STATUS_TEXT[s].replace(/ to parts$/, ""));
    clauses.push(`${what.join(" or ")} to parts of ${place}`);
  }
  return `The FCDO advises against ${clauses.join("; and against ")}`;
}

// Content API pages are reused while their update time is unchanged.
const g = globalThis as unknown as { __worldviewFcdo?: Map<string, FcdoPage> };
const pageCache = (g.__worldviewFcdo ??= new Map());

export async function fetchFcdoTravel(ctx: FetchContext): Promise<FcdoRaw> {
  const index = (await (await httpGet(API, ctx)).json()) as { links?: { children?: FcdoIndexChild[] } };
  const recent = recentFcdoChildren(index, ctx.now).slice(0, 80);
  const pages: FcdoPage[] = [];
  let i = 0;
  const worker = async () => {
    while (i < recent.length) {
      const child = recent[i++];
      const slug = child.details!.country!.slug!;
      const cached = pageCache.get(slug);
      if (cached && cached.updatedAt === child.public_updated_at) {
        pages.push(cached);
        continue;
      }
      try {
        const page = toFcdoPage(await (await httpGet(`${API}/${encodeURIComponent(slug)}`, ctx)).json());
        if (page) {
          pageCache.set(slug, page);
          pages.push(page);
        }
      } catch (e) {
        if (ctx.signal.aborted) throw e;
        // One unavailable page should not sink the rest.
      }
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  return { pages };
}

export function parseFcdoTravel(raw: FcdoRaw, ctx: ParseContext): ParseResult {
  const candidates: EventCandidateInput[] = [];
  let skipped = 0;
  for (const p of raw.pages ?? []) {
    const updated = p.updatedAt ? new Date(p.updatedAt) : null;
    const level = FCDO_STATUSES.find((s) => p.alertStatus.includes(s));
    const country = findCountryByName(p.name) ?? placesInText(p.name)[0]?.country;
    const advice = describeFcdoStatus(p.name, p.alertStatus);
    if (!isRecent(updated, ctx.now) || !level || !country || !advice) {
      skipped++;
      continue;
    }
    candidates.push(
      advisoryCandidate({
        dataSourceId: "fcdo-travel",
        key: p.slug,
        level,
        allLevels: FCDO_STATUSES,
        country,
        place: p.name,
        title: `UK travel advice: ${p.name} — FCDO advises against ${STATUS_TEXT[level]}`,
        summary: `The UK Foreign, Commonwealth & Development Office updated its travel advice for ${p.name} on ${updated.toISOString().slice(0, 10)}. ${advice}.`,
        description: p.changeDescription ? `Latest update: ${plainText(p.changeDescription, 400)}` : null,
        updated,
        url: p.url,
        government: { name: "UK Foreign, Commonwealth & Development Office", code: "FCDO" },
        sourceName: "UK FCDO — Foreign travel advice",
        credibility: "UK government (Foreign, Commonwealth & Development Office)",
        metrics: { fcdo_alert_status: p.alertStatus.join(",") },
        upstreamTitle: `${p.name} travel advice`,
        rawData: { slug: p.slug, alert_status: p.alertStatus, public_updated_at: p.updatedAt },
        retrievedAt: ctx.retrievedAt,
      }),
    );
  }
  return { candidates, skipped };
}

export const fcdoTravelConnector: DataSourceConnector<FcdoRaw> = {
  id: "fcdo-travel",
  name: "UK travel advice (FCDO)",
  description: "UK FCDO foreign travel advice updated in the last 30 days where the FCDO advises against all or all but essential travel to a country or parts of it.",
  homepage: "https://www.gov.uk/foreign-travel-advice",
  attribution: "UK Foreign, Commonwealth & Development Office — Open Government Licence v3.0",
  sourceType: "OFFICIAL_AGENCY",
  categories: ["POLITICS"],
  refreshIntervalMs: 6 * 60 * 60_000,
  timeoutMs: 60_000,
  mode: "live",
  fetch: fetchFcdoTravel,
  parse: parseFcdoTravel,
};
