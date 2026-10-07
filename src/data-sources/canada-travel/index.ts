/**
 * Government of Canada travel advisories (open data JSON, keyless).
 * Destinations at "Avoid non-essential travel" or "Avoid all travel" whose
 * advisory page was updated in the last 30 days.
 */
import { getCountry } from "@/lib/geo/gazetteer";
import type { EventCandidateInput } from "@/types/events";
import { httpGet, plainText, safeUrl, type DataSourceConnector, type FetchContext, type ParseContext, type ParseResult } from "../types";
import { advisoryCandidate, isRecent } from "../travel-advisories/common";

export interface CanadaAdvisory {
  "country-iso"?: string;
  "country-eng"?: string;
  "advisory-state"?: number;
  "date-published"?: { timestamp?: number; date?: string };
  "has-regional-advisory"?: number;
  "recent-updates-type"?: string;
  eng?: { name?: string; "url-slug"?: string; "advisory-text"?: string; "recent-updates"?: string };
}

export interface CanadaRaw {
  data?: Record<string, CanadaAdvisory>;
}

/** Feed `advisory-state`: 0 normal precautions, 1 high degree of caution, 2 avoid non-essential travel, 3 avoid all travel. */
const STATES = ["0", "1", "2", "3"] as const;
const MIN_STATE = 2;

export async function fetchCanadaTravel(ctx: FetchContext): Promise<CanadaRaw> {
  return (await (await httpGet("https://data.international.gc.ca/travel-voyage/index-updated.json", ctx)).json()) as CanadaRaw;
}

export function parseCanadaTravel(raw: CanadaRaw, ctx: ParseContext): ParseResult {
  const candidates: EventCandidateInput[] = [];
  let skipped = 0;
  for (const [iso, a] of Object.entries(raw.data ?? {})) {
    const state = Number(a["advisory-state"]);
    const ts = a["date-published"]?.timestamp;
    const updated = typeof ts === "number" ? new Date(ts * 1000) : null;
    const country = getCountry(a["country-iso"] ?? iso);
    const place = a.eng?.name ?? a["country-eng"] ?? country?.name;
    const advice = a.eng?.["advisory-text"]?.trim();
    if (!Number.isInteger(state) || state < MIN_STATE || !isRecent(updated, ctx.now) || !country || !place || !advice) {
      skipped++;
      continue;
    }
    const slug = a.eng?.["url-slug"];
    const update = plainText(a.eng?.["recent-updates"], 400);
    candidates.push(
      advisoryCandidate({
        dataSourceId: "canada-travel",
        key: country.code,
        level: String(state),
        allLevels: STATES,
        country,
        place,
        title: `Canada travel advisory: ${place} — ${advice}`,
        summary: `Global Affairs Canada updated its travel advisory for ${place} on ${updated.toISOString().slice(0, 10)}: ${advice}.`,
        description: update ? `Latest update${a["recent-updates-type"] ? ` (${a["recent-updates-type"].toLowerCase()})` : ""}: ${update}` : null,
        updated,
        url: slug ? safeUrl(`https://travel.gc.ca/destinations/${encodeURIComponent(slug)}`) : "https://travel.gc.ca/travelling/advisories",
        government: { name: "Global Affairs Canada", code: "GAC" },
        sourceName: "Government of Canada — Travel advice and advisories",
        credibility: "Government of Canada (Global Affairs Canada)",
        metrics: { advisory_state: state, regional_advisories: a["has-regional-advisory"] === 1 },
        upstreamTitle: `${place}: ${advice}`,
        rawData: { iso, state, date: a["date-published"]?.date ?? null, slug: slug ?? null },
        retrievedAt: ctx.retrievedAt,
      }),
    );
  }
  return { candidates, skipped };
}

export const canadaTravelConnector: DataSourceConnector<CanadaRaw> = {
  id: "canada-travel",
  name: "Canada travel advisories",
  description: "Government of Canada travel advisories at \"avoid non-essential travel\" or \"avoid all travel\" updated in the last 30 days.",
  homepage: "https://travel.gc.ca/travelling/advisories",
  attribution: "Global Affairs Canada — Open Government Licence – Canada",
  sourceType: "OFFICIAL_AGENCY",
  categories: ["POLITICS"],
  refreshIntervalMs: 6 * 60 * 60_000,
  mode: "live",
  fetch: fetchCanadaTravel,
  parse: parseCanadaTravel,
};
