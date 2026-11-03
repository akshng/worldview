/**
 * U.S. presidential disaster declarations from OpenFEMA (`DisasterDeclarationsSummaries` v2,
 * keyless). One event per declaration (DR major disaster, EM emergency, FM fire management)
 * made in the last 21 days, with the designated counties and assistance programmes. Placed at
 * the state's centre (region precision) — or the territory — since the API lists counties by
 * name and FIPS code without coordinates.
 */
import type { EventCandidateInput, EventCategory } from "@/types/events";
import { locateAddress, usStateName } from "@/lib/geo/gazetteer";
import { httpGet, plainText, type DataSourceConnector, type FetchContext, type ParseContext, type ParseResult } from "../types";
import { clip, makeSource } from "../official-common";

export interface FemaRow {
  femaDeclarationString?: string;
  disasterNumber?: number;
  state?: string;
  declarationType?: string;
  declarationDate?: string;
  incidentType?: string;
  declarationTitle?: string;
  incidentBeginDate?: string | null;
  incidentEndDate?: string | null;
  designatedArea?: string;
  ihProgramDeclared?: boolean;
  iaProgramDeclared?: boolean;
  paProgramDeclared?: boolean;
  hmProgramDeclared?: boolean;
}
export interface FemaRaw {
  rows: FemaRow[];
}

const MAX_AGE_MS = 21 * 86_400_000;
const FIELDS = "femaDeclarationString,disasterNumber,state,declarationType,declarationDate,incidentType,declarationTitle,incidentBeginDate,incidentEndDate,designatedArea,ihProgramDeclared,iaProgramDeclared,paProgramDeclared,hmProgramDeclared";

export async function fetchFema(ctx: FetchContext): Promise<FemaRaw> {
  const since = new Date(ctx.now - MAX_AGE_MS).toISOString();
  const url = `https://www.fema.gov/api/open/v2/DisasterDeclarationsSummaries?$filter=declarationDate%20ge%20'${since}'&$orderby=declarationDate%20desc&$top=1000&$select=${FIELDS}`;
  const json = (await (await httpGet(url, ctx)).json()) as { DisasterDeclarationsSummaries?: FemaRow[] };
  return { rows: Array.isArray(json.DisasterDeclarationsSummaries) ? json.DisasterDeclarationsSummaries : [] };
}

export function femaCategory(incident: string): EventCategory {
  const i = incident.toLowerCase();
  if (/flood|mud|landslide/.test(i)) return "FLOOD";
  if (/fire/.test(i)) return "FIRE";
  if (/earthquake/.test(i)) return "EARTHQUAKE";
  if (/volcan/.test(i)) return "VOLCANO";
  if (/hurricane|typhoon|tropical|storm|tornado|winter|snow|ice|freez|heat|drought|wind/.test(i)) return "WEATHER";
  if (/biological|pandemic/.test(i)) return "HEALTH";
  return "DISASTER";
}

const KIND: Record<string, string> = { DR: "Major disaster declaration", EM: "Emergency declaration", FM: "Fire management assistance declaration" };
const titleCase = (s: string) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

export function parseFema(raw: FemaRaw, ctx: ParseContext): ParseResult {
  const candidates: EventCandidateInput[] = [];
  let skipped = 0;
  const groups = new Map<string, FemaRow[]>();
  for (const r of raw.rows ?? []) {
    const id = (r.femaDeclarationString ?? "").trim();
    if (!/^(DR|EM|FM)-\d{3,5}-[A-Z]{2}$/.test(id)) {
      skipped++;
      continue;
    }
    groups.set(id, [...(groups.get(id) ?? []), r]);
  }
  for (const [id, rows] of groups) {
    const r = rows[0];
    const t = r.declarationDate ? Date.parse(r.declarationDate) : NaN;
    const state = (r.state ?? id.slice(-2)).toUpperCase();
    const loc = locateAddress(null, state);
    if (Number.isNaN(t) || ctx.now - t > MAX_AGE_MS || t > ctx.now + 86_400_000 || !loc) {
      skipped++;
      continue;
    }
    const ts = new Date(t).toISOString();
    const kind = KIND[id.slice(0, 2)] ?? "Declaration";
    const incident = plainText(r.incidentType, 60) || "Disaster";
    const name = titleCase(plainText(r.declarationTitle, 160) || incident);
    const areas = [...new Set(rows.map((x) => plainText(x.designatedArea, 80)).filter(Boolean))];
    const stateName = usStateName(state) ?? loc.label;
    const programs = [
      rows.some((x) => x.iaProgramDeclared || x.ihProgramDeclared) ? "individual assistance" : null,
      rows.some((x) => x.paProgramDeclared) ? "public assistance" : null,
      rows.some((x) => x.hmProgramDeclared) ? "hazard mitigation" : null,
    ].filter(Boolean);
    const began = r.incidentBeginDate?.slice(0, 10);
    candidates.push({
      type: femaCategory(incident),
      subtype: `FEMA ${kind.toLowerCase()}`,
      title: clip(`${kind} for ${stateName}: ${name} (${id})`),
      summary: clip(
        `FEMA ${kind.toLowerCase()} ${id} approved ${ts.slice(0, 10)} for ${stateName} (${incident.toLowerCase()}${began ? `, incident from ${began}` : ""}). ` +
          `${areas.length} designated area${areas.length === 1 ? "" : "s"}${areas.length ? `: ${areas.slice(0, 10).join(", ")}${areas.length > 10 ? ", …" : ""}` : ""}.` +
          `${programs.length ? ` Programs: ${programs.join(", ")}.` : ""} Shown at the state's centre (region precision).`,
        1990,
      ),
      description: null,
      latitude: loc.lat,
      longitude: loc.lon,
      geoPrecision: loc.precision === "city" ? "region" : loc.precision,
      locationName: stateName,
      country: "US",
      timestamp: ts,
      metrics: { declaration: id, disaster_number: r.disasterNumber ?? null, declaration_type: id.slice(0, 2), incident_type: incident, designated_areas: areas.length, individual_assistance: programs.includes("individual assistance") },
      entities: [{ type: "ORGANIZATION", name: "Federal Emergency Management Agency", code: "FEMA" }],
      source: makeSource({
        dataSourceId: "fema-declarations",
        externalId: id,
        sourceName: "OpenFEMA — disaster declarations",
        sourceUrl: r.disasterNumber ? `https://www.fema.gov/disaster/${r.disasterNumber}` : "https://www.fema.gov/disaster/declarations",
        title: `${kind}: ${name}`,
        publishedAt: ts,
        retrievedAt: ctx.retrievedAt,
        basis: "U.S. federal agency (FEMA) — presidential disaster declaration record",
      }),
      rawData: { id, state, incidentType: r.incidentType, declarationDate: r.declarationDate, areas: areas.slice(0, 40) },
    });
  }
  return { candidates, skipped };
}

export const femaDeclarationsConnector: DataSourceConnector<FemaRaw> = {
  id: "fema-declarations",
  name: "FEMA disaster declarations",
  description: "U.S. major disaster, emergency and fire-management declarations from OpenFEMA (last 21 days), with designated counties and assistance programmes, at the state.",
  homepage: "https://www.fema.gov/disaster/declarations",
  attribution: "FEMA — OpenFEMA data (public domain); FEMA does not endorse this application",
  sourceType: "OFFICIAL_AGENCY",
  categories: ["DISASTER", "WEATHER", "FLOOD", "FIRE", "EARTHQUAKE"],
  refreshIntervalMs: 60 * 60_000,
  timeoutMs: 30_000,
  mode: "live",
  fetch: fetchFema,
  parse: parseFema,
};
