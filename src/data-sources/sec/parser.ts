/**
 * SEC 8-K filings → BUSINESS events at the company's registered business address.
 * Only items that signal a material corporate event are kept (routine exhibits,
 * Reg FD and "other events" alone are skipped).
 */
import type { EventCandidateInput } from "@/types/events";
import { locateAddress } from "@/lib/geo/gazetteer";
import type { ParseContext, ParseResult } from "../types";
import type { SecRaw } from "./types";

export const MATERIAL_ITEMS: Record<string, { label: string; weight: number }> = {
  "1.03": { label: "Bankruptcy or receivership", weight: 0.85 },
  "1.05": { label: "Material cybersecurity incident", weight: 0.8 },
  "4.02": { label: "Prior financial statements no longer reliable", weight: 0.75 },
  "2.04": { label: "Obligation accelerated (triggering event)", weight: 0.6 },
  "3.01": { label: "Delisting or listing-standard notice", weight: 0.6 },
  "5.01": { label: "Change in control", weight: 0.6 },
  "2.01": { label: "Acquisition or disposition completed", weight: 0.45 },
  "2.05": { label: "Exit or restructuring costs", weight: 0.45 },
  "2.06": { label: "Material impairment", weight: 0.45 },
  "1.01": { label: "Material definitive agreement", weight: 0.35 },
  "1.02": { label: "Material agreement terminated", weight: 0.35 },
  "4.01": { label: "Change of auditor", weight: 0.35 },
  "2.02": { label: "Results of operations (earnings)", weight: 0.3 },
  "2.03": { label: "New material financial obligation", weight: 0.3 },
  "5.02": { label: "Director or officer change", weight: 0.3 },
};

export function parseSec(raw: SecRaw, ctx: ParseContext): ParseResult {
  const candidates: EventCandidateInput[] = [];
  let skipped = 0;
  for (const f of raw.entries) {
    const material = f.items.filter((i) => MATERIAL_ITEMS[i]).sort((a, b) => MATERIAL_ITEMS[b].weight - MATERIAL_ITEMS[a].weight);
    const co = raw.companies[f.cik];
    const loc = co ? locateAddress(co.city ? co.city.replace(/\b\w+/g, (w) => w[0] + w.slice(1).toLowerCase()) : null, co.stateOrCountry) : null;
    if (!material.length || !co || !loc || Number.isNaN(Date.parse(f.filedAt))) {
      skipped++;
      continue;
    }
    const main = MATERIAL_ITEMS[material[0]];
    const ticker = co.tickers[0] ?? null;
    const filed = new Date(f.filedAt).toISOString();
    candidates.push({
      type: "BUSINESS",
      subtype: "sec-8k",
      title: `${co.name}${ticker ? ` (${ticker})` : ""}: ${main.label}`,
      summary:
        `${co.name} filed a Form ${f.form} with the SEC on ${filed.slice(0, 10)} reporting: ` +
        `${material.map((i) => `Item ${i} ${MATERIAL_ITEMS[i].label}`).join("; ")}. ` +
        `Location shown is the company's registered business address.`,
      latitude: loc.lat,
      longitude: loc.lon,
      geoPrecision: loc.precision,
      locationName: loc.label,
      timestamp: filed,
      metrics: {
        ticker,
        exchange: co.exchanges[0] ?? null,
        industry: co.sicDescription,
        sec_items: material.join(", "),
        filing_weight: main.weight,
      },
      entities: [{ type: "ORGANIZATION", name: co.name, code: ticker }],
      source: {
        id: `sec:${f.accession}`,
        dataSourceId: "sec",
        externalId: f.accession,
        sourceName: "SEC EDGAR",
        sourceUrl: f.url,
        title: `${f.form} — ${co.name}`,
        titleIsDerived: false,
        publishedAt: filed,
        retrievedAt: ctx.retrievedAt,
        sourceType: "OFFICIAL_AGENCY",
        assertion: "OFFICIAL_FINAL",
        credibility: { basis: "Regulatory filing made by the company with the U.S. SEC" },
      },
      rawData: { ...f, company: co },
    });
  }
  return { candidates, skipped };
}
