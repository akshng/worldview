/**
 * U.S. Federal Register — presidential documents (executive orders, proclamations,
 * memoranda, determinations). Keyless public API.
 */
import type { EventCandidateInput } from "@/types/events";
import { placesInText } from "@/lib/geo/headline-places";
import { httpGet, safeUrl, type DataSourceConnector, type FetchContext, type ParseContext, type ParseResult } from "../types";

export interface FrDoc {
  title: string;
  type: string;
  document_number: string;
  html_url: string;
  publication_date: string;
  abstract: string | null;
  agencies?: Array<{ name?: string }>;
}
export interface FrRaw {
  results: FrDoc[];
}

/** Washington, DC (White House). */
const DC = { lat: 38.8977, lon: -77.0365 };

export async function fetchFederalRegister(ctx: FetchContext): Promise<FrRaw> {
  const since = new Date(ctx.now - 14 * 86_400_000).toISOString().slice(0, 10);
  const url =
    "https://www.federalregister.gov/api/v1/documents.json?per_page=100&order=newest" +
    `&conditions%5Btype%5D%5B%5D=PRESDOCU&conditions%5Bpublication_date%5D%5Bgte%5D=${since}` +
    "&fields%5B%5D=title&fields%5B%5D=type&fields%5B%5D=document_number&fields%5B%5D=html_url&fields%5B%5D=publication_date&fields%5B%5D=abstract&fields%5B%5D=agencies";
  return (await (await httpGet(url, ctx)).json()) as FrRaw;
}

export function parseFederalRegister(raw: FrRaw, ctx: ParseContext): ParseResult {
  const candidates: EventCandidateInput[] = [];
  let skipped = 0;
  for (const d of raw.results ?? []) {
    if (!d.title || !d.document_number || !/^\d{4}-\d{2}-\d{2}$/.test(d.publication_date ?? "")) {
      skipped++;
      continue;
    }
    // Place a document about a foreign country there; anything else at the White House.
    const foreign = placesInText(d.title).find((p) => p.country.code !== "US");
    const [lon, lat] = foreign ? (foreign.city ? [foreign.city.lon, foreign.city.lat] : foreign.country.label) : [DC.lon, DC.lat];
    const published = `${d.publication_date}T12:00:00.000Z`;
    candidates.push({
      type: "POLITICS",
      subtype: "presidential document",
      title: d.title.length > 290 ? `${d.title.slice(0, 289)}…` : d.title,
      summary:
        `U.S. presidential document published in the Federal Register on ${d.publication_date} (document ${d.document_number}).` +
        (foreign ? ` It concerns ${foreign.country.name}; shown there rather than in Washington.` : ""),
      description: d.abstract ?? null,
      latitude: lat,
      longitude: lon,
      geoPrecision: foreign ? (foreign.city ? "city" : "country") : "exact",
      locationName: foreign ? foreign.country.name : "The White House, Washington, DC",
      country: foreign ? foreign.country.code : "US",
      timestamp: published,
      metrics: { document_number: d.document_number },
      entities: [{ type: "ORGANIZATION", name: "Executive Office of the President", code: null }],
      source: {
        id: `federal-register:${d.document_number}`,
        dataSourceId: "federal-register",
        externalId: d.document_number,
        sourceName: "Federal Register (U.S. Office of the Federal Register)",
        sourceUrl: safeUrl(d.html_url),
        title: d.title,
        titleIsDerived: false,
        publishedAt: published,
        retrievedAt: ctx.retrievedAt,
        sourceType: "OFFICIAL_AGENCY",
        assertion: "OFFICIAL_FINAL",
        credibility: { basis: "Official journal of the U.S. federal government" },
      },
      rawData: { document_number: d.document_number, type: d.type, publication_date: d.publication_date },
    });
  }
  return { candidates, skipped };
}

export const federalRegisterConnector: DataSourceConnector<FrRaw> = {
  id: "federal-register",
  name: "US presidential documents",
  description: "Executive orders, proclamations, memoranda and determinations published in the U.S. Federal Register (last 14 days).",
  homepage: "https://www.federalregister.gov/presidential-documents",
  attribution: "Office of the Federal Register — public domain",
  sourceType: "OFFICIAL_AGENCY",
  categories: ["POLITICS"],
  refreshIntervalMs: 60 * 60_000,
  mode: "live",
  fetch: fetchFederalRegister,
  parse: parseFederalRegister,
};
