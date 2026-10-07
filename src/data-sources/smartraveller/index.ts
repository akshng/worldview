/**
 * Australian Government Smartraveller travel advice (public destinations
 * export JSON, keyless). Destinations whose overall level is "Reconsider your
 * need to travel" (level 3) or "Do not travel" (level 4), updated in the last 30 days.
 */
import { findCountryByName } from "@/lib/geo/gazetteer";
import { placesInText } from "@/lib/geo/headline-places";
import type { EventCandidateInput } from "@/types/events";
import { httpGet, plainText, safeUrl, type DataSourceConnector, type FetchContext, type ParseContext, type ParseResult } from "../types";
import { advisoryCandidate, isRecent } from "../travel-advisories/common";

export interface SmartravellerDestination {
  title?: string;
  field_overall_advice_level?: string;
  field_last_update?: string;
  field_region?: string;
  field_url?: string;
  changed?: string;
}

export interface SmartravellerRaw {
  destinations: SmartravellerDestination[];
}

/** Smartraveller's four advice levels. */
export const SMARTRAVELLER_LEVELS: Record<string, number> = {
  "exercise normal safety precautions": 1,
  "exercise a high degree of caution": 2,
  "reconsider your need to travel": 3,
  "do not travel": 4,
};
const LEVEL_KEYS = ["1", "2", "3", "4"] as const;

export async function fetchSmartraveller(ctx: FetchContext): Promise<SmartravellerRaw> {
  const j = await (await httpGet("https://www.smartraveller.gov.au/destinations-export", ctx)).json();
  return { destinations: Array.isArray(j) ? (j as SmartravellerDestination[]) : [] };
}

/** Sydney's UTC offset in hours on a local date: AEDT (+11) from the first Sunday of October to the first Sunday of April, else AEST (+10). */
export function sydneyOffsetHours(y: number, m: number, d: number, h: number): number {
  const firstSunday = (month: number) => {
    const dow = new Date(Date.UTC(y, month - 1, 1)).getUTCDay();
    return 1 + ((7 - dow) % 7);
  };
  if (m > 4 && m < 10) return 10;
  if (m === 4) return d < firstSunday(4) || (d === firstSunday(4) && h < 3) ? 11 : 10;
  if (m === 10) return d > firstSunday(10) || (d === firstSunday(10) && h >= 2) ? 11 : 10;
  return 11;
}

/** "Wed, 2026-10-07 10:33" (Sydney local time) → Date. */
export function parseSmartravellerChanged(s: string | undefined): Date | null {
  const m = s?.match(/(\d{4})-(\d{2})-(\d{2})\s+(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  return new Date(Date.UTC(y, mo - 1, d, h - sydneyOffsetHours(y, mo, d, h), mi));
}

export function parseSmartraveller(raw: SmartravellerRaw, ctx: ParseContext): ParseResult {
  const candidates: EventCandidateInput[] = [];
  let skipped = 0;
  for (const dst of raw.destinations ?? []) {
    const place = dst.title?.trim();
    const advice = dst.field_overall_advice_level?.trim();
    const level = advice ? SMARTRAVELLER_LEVELS[advice.toLowerCase()] : undefined;
    const updated = parseSmartravellerChanged(dst.changed);
    const country = place ? (findCountryByName(place) ?? placesInText(place)[0]?.country) : undefined;
    const url = safeUrl(dst.field_url);
    if (!place || !advice || !level || level < 3 || !isRecent(updated, ctx.now) || !country) {
      skipped++;
      continue;
    }
    const slug = url?.split("/").filter(Boolean).pop() ?? country.code;
    candidates.push(
      advisoryCandidate({
        dataSourceId: "smartraveller",
        key: slug,
        level: String(level),
        allLevels: LEVEL_KEYS,
        country,
        place,
        title: `Australia travel advice: ${place} — Level ${level}, ${advice.toLowerCase()}`,
        summary: `The Australian Government's Smartraveller updated its travel advice for ${place} on ${updated.toISOString().slice(0, 10)}: Level ${level} (${advice}).`,
        description: plainText(dst.field_last_update, 400).replace(/\s+([.,;:])/g, "$1") || null,
        updated,
        url,
        government: { name: "Australian Department of Foreign Affairs and Trade", code: "DFAT" },
        sourceName: "Smartraveller (Australian Government)",
        credibility: "Australian Government (Department of Foreign Affairs and Trade)",
        metrics: { advisory_level: level },
        upstreamTitle: `${place}: ${advice}`,
        rawData: { title: dst.title, level: dst.field_overall_advice_level, changed: dst.changed, url: dst.field_url },
        retrievedAt: ctx.retrievedAt,
      }),
    );
  }
  return { candidates, skipped };
}

export const smartravellerConnector: DataSourceConnector<SmartravellerRaw> = {
  id: "smartraveller",
  name: "Australia travel advice (Smartraveller)",
  description: "Australian Government Smartraveller advice at level 3–4 (reconsider your need to travel, do not travel) updated in the last 30 days.",
  homepage: "https://www.smartraveller.gov.au/destinations",
  attribution: "Australian Government Department of Foreign Affairs and Trade — CC BY 4.0",
  sourceType: "OFFICIAL_AGENCY",
  categories: ["POLITICS"],
  refreshIntervalMs: 6 * 60 * 60_000,
  mode: "live",
  fetch: fetchSmartraveller,
  parse: parseSmartraveller,
};
