/**
 * U.S. Consumer Product Safety Commission recalls (SaferProducts.gov REST API, keyless).
 * Recalls dated in the last 21 days, placed at CPSC headquarters (recalls are nationwide).
 */
import type { EventCandidateInput } from "@/types/events";
import { httpGet, plainText, safeUrl, type DataSourceConnector, type FetchContext, type ParseContext, type ParseResult } from "../types";
import { HQ, clip, makeSource } from "../official-common";

export interface CpscRecall {
  RecallID: number;
  RecallNumber: string | null;
  RecallDate: string | null;
  Title: string | null;
  Description?: string | null;
  URL?: string | null;
  Products?: Array<{ Name?: string; NumberOfUnits?: string; Type?: string }>;
  Hazards?: Array<{ Name?: string }>;
  Injuries?: Array<{ Name?: string }>;
  ManufacturerCountries?: Array<{ Country?: string }>;
  RemedyOptions?: Array<{ Option?: string }>;
}
export interface CpscRaw {
  recalls: CpscRecall[];
}

const WINDOW_DAYS = 21;

export async function fetchCpsc(ctx: FetchContext): Promise<CpscRaw> {
  const start = new Date(ctx.now - WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);
  const j = (await (await httpGet(`https://www.saferproducts.gov/RestWebServices/Recall?format=json&RecallDateStart=${start}`, ctx)).json()) as CpscRecall[];
  // On a backend error the API answers 200 with a single placeholder record.
  if (Array.isArray(j) && j.length === 1 && j[0].RecallID === 0 && /^Error/i.test(j[0].Title ?? "")) throw new Error(`CPSC API: ${j[0].Title}`);
  return { recalls: (Array.isArray(j) ? j : []).map((r) => ({ ...r, Images: undefined, Retailers: undefined } as CpscRecall)) };
}

const NONE = /^none reported\.?$/i;

export function parseCpsc(raw: CpscRaw, ctx: ParseContext): ParseResult {
  const candidates: EventCandidateInput[] = [];
  let skipped = 0;
  for (const r of raw.recalls ?? []) {
    const date = r.RecallDate?.slice(0, 10);
    const title = plainText(r.Title, 400);
    if (!r.RecallID || !title || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || ctx.now - Date.parse(date) > (WINDOW_DAYS + 1) * 86_400_000) {
      skipped++;
      continue;
    }
    const ts = `${date}T12:00:00.000Z`;
    const units = (r.Products ?? []).map((p) => p.NumberOfUnits).filter(Boolean).join("; ");
    const hazards = (r.Hazards ?? []).map((h) => plainText(h.Name, 200)).filter((h) => h && !NONE.test(h));
    const injuries = (r.Injuries ?? []).map((h) => plainText(h.Name, 200)).filter(Boolean);
    const made = (r.ManufacturerCountries ?? []).map((c) => c.Country).filter(Boolean);
    candidates.push({
      type: "OTHER",
      subtype: "product recall",
      title: clip(title),
      summary:
        `The U.S. Consumer Product Safety Commission announced recall ${r.RecallNumber ?? r.RecallID} on ${date}: ${title}.` +
        `${units ? ` Units: ${units}.` : ""}${hazards.length ? ` Hazard: ${hazards.join(" ")}` : ""}${injuries.length ? ` Injuries: ${injuries.join(" ")}` : ""}` +
        `${made.length ? ` Manufactured in: ${made.join(", ")}.` : ""} Nationwide recall shown at CPSC headquarters. Date only.`.slice(0, 1990),
      description: plainText(r.Description, 1500) || null,
      latitude: HQ.cpsc.lat,
      longitude: HQ.cpsc.lon,
      geoPrecision: "city",
      locationName: HQ.cpsc.name,
      country: "US",
      timestamp: ts,
      metrics: { recall_number: r.RecallNumber ?? null, units: units || null, date_only: true },
      entities: [{ type: "ORGANIZATION", name: "U.S. Consumer Product Safety Commission", code: "CPSC" }],
      source: makeSource({
        dataSourceId: "cpsc-recalls",
        externalId: String(r.RecallNumber ?? r.RecallID),
        sourceName: "U.S. Consumer Product Safety Commission recalls",
        sourceUrl: safeUrl(r.URL) ?? "https://www.cpsc.gov/Recalls",
        title,
        publishedAt: ts,
        retrievedAt: ctx.retrievedAt,
        basis: "U.S. Consumer Product Safety Commission (federal agency)",
      }),
      rawData: { RecallID: r.RecallID, RecallNumber: r.RecallNumber, RecallDate: r.RecallDate },
    });
  }
  return { candidates, skipped };
}

export const cpscRecallsConnector: DataSourceConnector<CpscRaw> = {
  id: "cpsc-recalls",
  name: "US consumer product recalls",
  description: "Consumer product recalls announced by the U.S. CPSC in the last 21 days, with units, hazards and injuries.",
  homepage: "https://www.cpsc.gov/Recalls",
  attribution: "U.S. Consumer Product Safety Commission (SaferProducts.gov API) — public domain",
  sourceType: "OFFICIAL_AGENCY",
  categories: ["OTHER"],
  refreshIntervalMs: 6 * 60 * 60_000,
  timeoutMs: 45_000,
  mode: "live",
  fetch: fetchCpsc,
  parse: parseCpsc,
};
