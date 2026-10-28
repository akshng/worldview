/**
 * U.S. FDA Class I recalls (the most serious class: reasonable probability of serious
 * harm or death) of food, drugs and medical devices, from openFDA enforcement reports
 * (keyless; 1,000 requests/day per IP). Reports from the last 14 days, one event per
 * recall event id, placed at the recalling firm's city.
 */
import type { EventCandidateInput } from "@/types/events";
import { locateAddress } from "@/lib/geo/gazetteer";
import { httpGet, plainText, SourceHttpError, type DataSourceConnector, type FetchContext, type ParseContext, type ParseResult } from "../types";
import { HQ, clip, makeSource } from "../official-common";

export interface FdaEnforcement {
  recall_number: string;
  event_id: string;
  status?: string;
  classification: string;
  product_type?: string;
  recalling_firm: string;
  city?: string;
  state?: string;
  country?: string;
  product_description?: string;
  reason_for_recall?: string;
  distribution_pattern?: string;
  product_quantity?: string;
  voluntary_mandated?: string;
  recall_initiation_date?: string;
  report_date: string;
}
export interface FdaRaw {
  results: Array<FdaEnforcement & { category: "food" | "drug" | "device" }>;
}

const CATEGORIES = ["food", "drug", "device"] as const;
const WINDOW_DAYS = 14;
const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10).replace(/-/g, "");

export async function fetchFdaRecalls(ctx: FetchContext): Promise<FdaRaw> {
  const range = `report_date:[${ymd(ctx.now - WINDOW_DAYS * 86_400_000)}+TO+${ymd(ctx.now)}]`;
  const results: FdaRaw["results"] = [];
  let failures = 0;
  for (const category of CATEGORIES) {
    const url = `https://api.fda.gov/${category}/enforcement.json?search=${range}+AND+classification:%22Class+I%22&limit=100&sort=report_date:desc`;
    try {
      const j = (await (await httpGet(url, ctx)).json()) as { results?: FdaEnforcement[] };
      for (const r of j.results ?? []) results.push({ ...r, category });
    } catch (e) {
      // openFDA answers 404 when nothing matches.
      if (!(e instanceof SourceHttpError && e.status === 404)) failures++;
      if (failures === CATEGORIES.length) throw e;
    }
  }
  return { results };
}

/** "20261021" → "2026-10-21" */
export const fdaDate = (s: string | undefined) => (s && /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : null);

/** First clause of a product description: "Stewarts Shops Vanilla Heavenly Medley 1/2 Gallon". */
export function productName(desc: string | undefined): string {
  const d = plainText(desc, 400);
  const first = d.split(/[,;:]\s|\.\s|\s\(|\s-\s/)[0]?.trim() ?? "";
  return clip(first || d, 90);
}

const LABEL = { food: "food", drug: "drug", device: "medical device" } as const;

export function parseFdaRecalls(raw: FdaRaw, ctx: ParseContext): ParseResult {
  const candidates: EventCandidateInput[] = [];
  let skipped = 0;
  const groups = new Map<string, FdaRaw["results"]>();
  for (const r of raw.results ?? []) {
    const date = fdaDate(r.report_date);
    if (r.classification !== "Class I" || !r.event_id || !r.recalling_firm || !date || ctx.now - Date.parse(date) > (WINDOW_DAYS + 1) * 86_400_000) {
      skipped++;
      continue;
    }
    const key = `${r.category}:${r.event_id}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  for (const [key, rs] of groups) {
    const r = rs[0];
    const date = [...rs.map((x) => fdaDate(x.report_date)!)].sort()[0];
    const isUs = !r.country || /^united states$/i.test(r.country);
    const loc = r.city ? locateAddress(r.city, isUs ? (r.state ?? null) : (r.country ?? null)) : null;
    const place = loc ?? null;
    const firm = plainText(r.recalling_firm, 120);
    const product = productName(r.product_description);
    const reason = plainText(r.reason_for_recall, 600);
    const ts = `${date}T12:00:00.000Z`;
    const where = [r.city, isUs ? r.state : r.country].filter(Boolean).join(", ");
    const title = clip(`FDA Class I ${LABEL[r.category]} recall: ${firm} — ${product}`);
    skipped += rs.length - 1;
    candidates.push({
      type: "HEALTH",
      subtype: `${LABEL[r.category]} recall`,
      title,
      summary:
        `FDA enforcement report of ${date}: ${firm}${where ? ` (${where})` : ""} is recalling ${rs.length > 1 ? `${rs.length} products` : "a product"} (Class I — the most serious class). ` +
        `${reason ? `Reason: ${reason}` : ""}${r.distribution_pattern ? ` Distribution: ${plainText(r.distribution_pattern, 200)}.` : ""}` +
        `${place ? "" : " Shown at FDA headquarters (firm location not matched)."} Date only.`,
      description: plainText(r.product_description, 1500) || null,
      latitude: place ? place.lat : HQ.fda.lat,
      longitude: place ? place.lon : HQ.fda.lon,
      geoPrecision: place ? place.precision : "city",
      locationName: place ? place.label : HQ.fda.name,
      country: place ? null : "US",
      timestamp: ts,
      metrics: { classification: "Class I", products: rs.length, status: r.status ?? null, voluntary: r.voluntary_mandated ?? null, date_only: true },
      entities: [{ type: "ORGANIZATION", name: firm, code: null }, { type: "ORGANIZATION", name: "U.S. Food and Drug Administration", code: "FDA" }],
      source: makeSource({
        dataSourceId: "fda-recalls",
        externalId: key,
        sourceName: "openFDA enforcement reports (U.S. FDA)",
        // The enforcement record itself (openFDA has no per-recall web page).
        sourceUrl: `https://api.fda.gov/${r.category}/enforcement.json?search=event_id:${encodeURIComponent(r.event_id)}`,
        title,
        publishedAt: ts,
        retrievedAt: ctx.retrievedAt,
        basis: "U.S. Food and Drug Administration enforcement report",
      }),
      rawData: { event_id: r.event_id, recall_numbers: rs.map((x) => x.recall_number).slice(0, 20), category: r.category, report_date: r.report_date },
    });
  }
  return { candidates, skipped };
}

export const fdaRecallsConnector: DataSourceConnector<FdaRaw> = {
  id: "fda-recalls",
  name: "FDA Class I recalls",
  description: "Class I recalls of food, drugs and medical devices from FDA enforcement reports (last 14 days), at the recalling firm's city.",
  homepage: "https://open.fda.gov/apis/food/enforcement/",
  attribution: "U.S. Food and Drug Administration via openFDA — public domain; openFDA does not endorse this product",
  sourceType: "OFFICIAL_AGENCY",
  categories: ["HEALTH"],
  refreshIntervalMs: 6 * 60 * 60_000,
  mode: "live",
  fetch: fetchFdaRecalls,
  parse: parseFdaRecalls,
};
