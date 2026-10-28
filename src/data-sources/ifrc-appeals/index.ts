/**
 * IFRC GO public appeals API (keyless): DREF allocations and Emergency Appeals launched by the
 * International Federation of Red Cross and Red Crescent Societies in the last 30 days, with
 * the amount requested and funded. Shown at the affected country (label point; country
 * precision). The country comes from the record, else from the IFRC appeal code
 * ("MDR" + ISO 3166-1 alpha-2 + number), else from the appeal name.
 */
import type { EventCandidateInput, EventCategory } from "@/types/events";
import { findCountryByName, getCountry, type Country } from "@/lib/geo/gazetteer";
import { httpGet, plainText, type DataSourceConnector, type FetchContext, type ParseContext, type ParseResult } from "../types";
import { clip, makeSource } from "../official-common";

export interface IfrcAppeal {
  aid?: string;
  id?: string | number;
  name?: string;
  code?: string;
  atype_display?: string;
  status_display?: string;
  dtype?: { name?: string } | null;
  num_beneficiaries?: number | null;
  amount_requested?: number | null;
  amount_funded?: number | null;
  start_date?: string | null;
  end_date?: string | null;
  created_at?: string | null;
  event?: number | null;
  country?: { iso?: string | null; iso3?: string | null; name?: string | null } | null;
}

export interface IfrcRaw {
  results: IfrcAppeal[];
}

const APPEALS_URL = "https://goadmin.ifrc.org/api/v2/appeal/?limit=60&ordering=-start_date";
const MAX_AGE_MS = 30 * 86_400_000;

export async function fetchIfrc(ctx: FetchContext): Promise<IfrcRaw> {
  const json = (await (await httpGet(APPEALS_URL, ctx)).json()) as { results?: IfrcAppeal[] };
  return { results: Array.isArray(json.results) ? json.results : [] };
}

/** IFRC disaster type → event category. */
export function ifrcCategory(dtype: string | undefined): EventCategory {
  const d = (dtype ?? "").toLowerCase();
  if (/flood/.test(d)) return "FLOOD";
  if (/epidemic|pandemic|biological/.test(d)) return "HEALTH";
  if (/earthquake|tsunami/.test(d)) return "EARTHQUAKE";
  if (/volcan/.test(d)) return "VOLCANO";
  if (/fire/.test(d)) return "FIRE";
  if (/cyclone|storm|cold wave|heat wave|extreme temperature|hail/.test(d)) return "WEATHER";
  if (/civil unrest|complex emergency/.test(d)) return "CONFLICT";
  return "DISASTER";
}

export function ifrcCountry(a: IfrcAppeal): Country | undefined {
  const fromRecord = getCountry(a.country?.iso ?? a.country?.iso3 ?? null);
  if (fromRecord) return fromRecord;
  const code = a.code?.match(/^MDR([A-Z]{2})\d/)?.[1];
  const fromCode = code ? getCountry(code) : undefined;
  if (fromCode) return fromCode;
  const lead = (a.name ?? "").split(/\s[-–]\s|-/)[0]?.trim();
  return lead ? findCountryByName(lead) : undefined;
}

const chf = (n: number) => `CHF ${Math.round(n).toLocaleString("en-US")}`;

export function parseIfrc(raw: IfrcRaw, ctx: ParseContext): ParseResult {
  const candidates: EventCandidateInput[] = [];
  let skipped = 0;
  const seen = new Set<string>();
  for (const a of raw.results ?? []) {
    const name = plainText(a.name, 250);
    const code = (a.code ?? "").trim();
    const t = a.start_date ? Date.parse(a.start_date) : NaN;
    const country = ifrcCountry(a);
    if (!name || !code || Number.isNaN(t) || ctx.now - t > MAX_AGE_MS || t > ctx.now + 86_400_000 || !country || seen.has(code)) {
      skipped++;
      continue;
    }
    seen.add(code);
    const ts = new Date(t).toISOString();
    const kind = plainText(a.atype_display, 40) || "Appeal";
    const dtype = plainText(a.dtype?.name, 60) || null;
    const requested = typeof a.amount_requested === "number" && a.amount_requested > 0 ? a.amount_requested : null;
    const funded = typeof a.amount_funded === "number" && a.amount_funded >= 0 ? a.amount_funded : null;
    const people = typeof a.num_beneficiaries === "number" && a.num_beneficiaries > 0 ? a.num_beneficiaries : null;
    const title = kind && !name.toLowerCase().includes(kind.toLowerCase()) ? `${name} (IFRC ${kind})` : `${name} (IFRC)`;
    const facts = [
      requested !== null ? `${chf(requested)} requested` : null,
      funded !== null && requested !== null ? `${chf(funded)} funded` : null,
      people !== null ? `${people.toLocaleString("en-US")} people targeted` : null,
    ].filter(Boolean);
    const link = typeof a.event === "number" ? `https://go.ifrc.org/emergencies/${a.event}` : null;
    candidates.push({
      type: ifrcCategory(a.dtype?.name),
      subtype: `IFRC ${kind}${dtype ? ` — ${dtype}` : ""}`,
      title: clip(title),
      summary: `The IFRC launched ${kind === "DREF" ? "a DREF (Disaster Response Emergency Fund) allocation" : `an ${kind}`} ${code} on ${ts.slice(0, 10)} for ${country.name}${dtype ? ` (${dtype.toLowerCase()})` : ""}.${facts.length ? ` ${facts.join("; ")}.` : ""}${a.end_date ? ` Operation planned to ${a.end_date.slice(0, 10)}.` : ""} Shown at the country's centre (country precision).`,
      description: null,
      latitude: country.label[1],
      longitude: country.label[0],
      geoPrecision: "country",
      locationName: country.name,
      country: country.code,
      timestamp: ts,
      metrics: { appeal_code: code, appeal_type: kind, disaster_type: dtype, amount_requested_chf: requested, amount_funded_chf: funded, beneficiaries: people, status: a.status_display ?? null },
      entities: [
        { type: "ORGANIZATION", name: "International Federation of Red Cross and Red Crescent Societies", code: "IFRC" },
        { type: "COUNTRY", name: country.name, code: country.code },
      ],
      source: makeSource({
        dataSourceId: "ifrc-appeals",
        externalId: code,
        sourceName: "IFRC GO — appeals",
        sourceUrl: link,
        title: name,
        publishedAt: a.created_at && !Number.isNaN(Date.parse(a.created_at)) ? new Date(Date.parse(a.created_at)).toISOString() : ts,
        retrievedAt: ctx.retrievedAt,
        basis: "International Federation of Red Cross and Red Crescent Societies (GO platform)",
      }),
      rawData: { code, aid: a.aid ?? null, event: a.event ?? null, start_date: a.start_date, country: a.country?.iso ?? null },
    });
  }
  return { candidates, skipped };
}

export const ifrcAppealsConnector: DataSourceConnector<IfrcRaw> = {
  id: "ifrc-appeals",
  name: "IFRC emergency appeals",
  description: "IFRC DREF allocations and Emergency Appeals launched in the last 30 days, with amounts requested/funded, at the affected country.",
  homepage: "https://go.ifrc.org/",
  attribution: "International Federation of Red Cross and Red Crescent Societies — IFRC GO public API; link back to go.ifrc.org",
  sourceType: "OFFICIAL_AGENCY",
  categories: ["DISASTER", "FLOOD", "HEALTH", "EARTHQUAKE", "WEATHER", "FIRE", "VOLCANO", "CONFLICT"],
  refreshIntervalMs: 60 * 60_000,
  timeoutMs: 30_000,
  mode: "live",
  fetch: fetchIfrc,
  parse: parseIfrc,
};
