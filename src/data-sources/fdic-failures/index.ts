/** U.S. bank failures from the FDIC public API (keyless), placed at the bank's city. Last 2 years. */
import type { EventCandidateInput } from "@/types/events";
import { locateAddress } from "@/lib/geo/gazetteer";
import { httpGet, type DataSourceConnector, type FetchContext, type ParseContext, type ParseResult } from "../types";

export interface FdicFailure {
  NAME?: string;
  CITYST?: string;
  FAILDATE?: string;
  QBFASSET?: number;
  QBFDEP?: number;
  COST?: number | null;
  RESTYPE?: string;
  RESTYPE1?: string;
  BIDNAME?: string;
  FIN?: string;
  CERT?: number;
}
export interface FdicRaw {
  failures: FdicFailure[];
}

const MAX_AGE_MS = 2 * 365 * 86_400_000;

export async function fetchFdicFailures(ctx: FetchContext): Promise<FdicRaw> {
  const j = (await (await httpGet("https://api.fdic.gov/banks/failures?sort_by=FAILDATE&sort_order=DESC&limit=40", ctx)).json()) as { data?: Array<{ data: FdicFailure }> };
  return { failures: (j.data ?? []).map((d) => d.data) };
}

/** "7/17/2026" → ISO date */
export function fdicDate(s: string | undefined): string | null {
  const m = s?.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}` : null;
}

const money = (thousands: number | undefined | null) =>
  typeof thousands === "number" ? (thousands >= 1e6 ? `$${(thousands / 1e6).toFixed(1)} billion` : `$${(thousands / 1e3).toFixed(1)} million`) : null;
const titleCase = (s: string) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

export function parseFdicFailures(raw: FdicRaw, ctx: ParseContext): ParseResult {
  const candidates: EventCandidateInput[] = [];
  let skipped = 0;
  for (const f of raw.failures ?? []) {
    const date = fdicDate(f.FAILDATE);
    const [city, state] = (f.CITYST ?? "").split(",").map((x) => x.trim());
    const loc = city && state ? locateAddress(city, state) : null;
    if (!date || !f.NAME || !loc || ctx.now - Date.parse(date) > MAX_AGE_MS) {
      skipped++;
      continue;
    }
    const name = titleCase(f.NAME);
    const ts = `${date}T12:00:00.000Z`;
    const id = f.FIN ?? `${f.CERT ?? name}-${date}`;
    candidates.push({
      type: "BUSINESS",
      subtype: "bank failure",
      title: `Bank failure: ${name} (${titleCase(city)}, ${state})`,
      summary:
        `The FDIC lists ${name} of ${titleCase(city)}, ${state} as failed on ${date}` +
        `${f.QBFASSET ? `, with about ${money(f.QBFASSET)} in assets` : ""}${f.QBFDEP ? ` and ${money(f.QBFDEP)} in deposits` : ""}.` +
        `${f.BIDNAME ? ` Acquirer: ${titleCase(f.BIDNAME)}.` : ""}${f.COST ? ` Estimated cost to the Deposit Insurance Fund: ${money(f.COST)}.` : ""} Date only.`,
      latitude: loc.lat,
      longitude: loc.lon,
      geoPrecision: loc.precision,
      locationName: `${titleCase(city)}, ${state}`,
      country: "US",
      timestamp: ts,
      metrics: { assets_thousands: f.QBFASSET ?? null, deposits_thousands: f.QBFDEP ?? null, dif_cost_thousands: f.COST ?? null, date_only: true },
      entities: [{ type: "ORGANIZATION", name, code: null }, { type: "ORGANIZATION", name: "FDIC", code: null }],
      source: {
        id: `fdic-failures:${id}`,
        dataSourceId: "fdic-failures",
        externalId: String(id),
        sourceName: "FDIC failed bank list",
        sourceUrl: "https://www.fdic.gov/bank-failures/failed-bank-list",
        title: f.NAME,
        titleIsDerived: false,
        publishedAt: ts,
        retrievedAt: ctx.retrievedAt,
        sourceType: "OFFICIAL_AGENCY",
        assertion: "OFFICIAL_FINAL",
        credibility: { basis: "U.S. federal deposit insurer (FDIC)" },
      },
      rawData: f,
    });
  }
  return { candidates, skipped };
}

export const fdicFailuresConnector: DataSourceConnector<FdicRaw> = {
  id: "fdic-failures",
  name: "US bank failures",
  description: "FDIC-insured banks that failed in the last two years, with assets, deposits, acquirer and estimated cost to the insurance fund.",
  homepage: "https://www.fdic.gov/bank-failures/failed-bank-list",
  attribution: "Federal Deposit Insurance Corporation — public domain",
  sourceType: "OFFICIAL_AGENCY",
  categories: ["BUSINESS"],
  refreshIntervalMs: 12 * 60 * 60_000,
  mode: "live",
  fetch: fetchFdicFailures,
  parse: parseFdicFailures,
};
