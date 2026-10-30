/**
 * FEMA disaster declarations (OpenFEMA API v2, keyless): major disaster (DR), emergency (EM)
 * and fire management assistance (FM) declarations of the last 30 days. OpenFEMA returns one
 * row per designated area (county, tribal area); rows are grouped into one event per
 * declaration and shown at the centre of the state's known cities (region precision).
 */
import type { EventCandidateInput, EventCategory } from "@/types/events";
import { locateAddress, usStateName } from "@/lib/geo/gazetteer";
import { httpGet, plainText, type DataSourceConnector, type FetchContext, type ParseContext, type ParseResult } from "../types";
import { clip, makeSource } from "../official-common";

export interface FemaDeclarationRow {
  femaDeclarationString?: string;
  disasterNumber?: number;
  state?: string;
  declarationType?: string;
  declarationDate?: string;
  incidentType?: string;
  declarationTitle?: string;
  incidentBeginDate?: string | null;
  incidentEndDate?: string | null;
  designatedArea?: string | null;
  ihProgramDeclared?: boolean;
  iaProgramDeclared?: boolean;
  paProgramDeclared?: boolean;
  hmProgramDeclared?: boolean;
  tribalRequest?: boolean;
}

export interface FemaRaw {
  rows: FemaDeclarationRow[];
}

const MAX_AGE_MS = 30 * 86_400_000;
const API = "https://www.fema.gov/api/open/v2/DisasterDeclarationsSummaries";

export async function fetchFema(ctx: FetchContext): Promise<FemaRaw> {
  const since = new Date(ctx.now - MAX_AGE_MS).toISOString().slice(0, 10);
  const qs = new URLSearchParams({
    $filter: `declarationDate ge '${since}T00:00:00.000Z'`,
    $orderby: "declarationDate desc",
    $top: "1000",
  });
  const json = (await (await httpGet(`${API}?${qs}`, ctx)).json()) as { DisasterDeclarationsSummaries?: FemaDeclarationRow[] };
  return { rows: Array.isArray(json.DisasterDeclarationsSummaries) ? json.DisasterDeclarationsSummaries : [] };
}

export const FEMA_TYPES: Record<string, string> = {
  DR: "Major Disaster Declaration",
  EM: "Emergency Declaration",
  FM: "Fire Management Assistance Declaration",
};

/** OpenFEMA incident type → event category. */
export function femaCategory(incident: string | undefined): EventCategory {
  const i = (incident ?? "").toLowerCase();
  if (/fire/.test(i)) return "FIRE";
  if (/flood|dam|levee/.test(i)) return "FLOOD";
  if (/earthquake|tsunami/.test(i)) return "EARTHQUAKE";
  if (/volcan/.test(i)) return "VOLCANO";
  if (/biological|pandemic|toxic|chemical/.test(i)) return "HEALTH";
  if (/hurricane|typhoon|tropical|storm|tornado|snow|ice|winter|freez|coastal|mud ?slide|severe/.test(i)) return "WEATHER";
  return "DISASTER";
}

/** OpenFEMA titles are upper case ("SEVERE STORMS AND FLOODING") → "Severe Storms and Flooding". */
export function femaTitleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/[a-z][a-z']*/g, (w, i: number) => (i > 0 && /^(and|of|the|or|in|to)$/.test(w) ? w : w[0].toUpperCase() + w.slice(1)));
}

const day = (s: string | null | undefined) => (s && !Number.isNaN(Date.parse(s)) ? new Date(Date.parse(s)).toISOString().slice(0, 10) : null);

export function parseFema(raw: FemaRaw, ctx: ParseContext): ParseResult {
  const groups = new Map<string, FemaDeclarationRow[]>();
  let skipped = 0;
  for (const r of raw.rows ?? []) {
    const id = (r.femaDeclarationString ?? "").trim() || (r.disasterNumber ? `${r.declarationType ?? "??"}-${r.disasterNumber}-${r.state ?? ""}` : "");
    if (!id) {
      skipped++;
      continue;
    }
    groups.set(id, [...(groups.get(id) ?? []), r]);
  }
  const candidates: EventCandidateInput[] = [];
  for (const [id, rows] of groups) {
    const r = rows[0];
    const t = r.declarationDate ? Date.parse(r.declarationDate) : NaN;
    const stateCode = (r.state ?? "").toUpperCase();
    const stateName = usStateName(stateCode);
    const loc = stateName ? locateAddress(null, stateCode) : null;
    const declTitle = plainText(r.declarationTitle, 200);
    if (Number.isNaN(t) || ctx.now - t > MAX_AGE_MS || t > ctx.now + 86_400_000 || !loc || !declTitle) {
      skipped += rows.length;
      continue;
    }
    const ts = new Date(t).toISOString();
    const kind = FEMA_TYPES[(r.declarationType ?? "").toUpperCase()] ?? "Declaration";
    const incident = plainText(r.incidentType, 60) || null;
    const areas = [...new Set(rows.map((x) => plainText(x.designatedArea, 80)).filter(Boolean))];
    const programs = [
      r.iaProgramDeclared || r.ihProgramDeclared ? "Individual Assistance" : null,
      r.paProgramDeclared ? "Public Assistance" : null,
      r.hmProgramDeclared ? "Hazard Mitigation" : null,
    ].filter(Boolean);
    const begin = day(r.incidentBeginDate);
    const name = femaTitleCase(declTitle);
    const link = r.disasterNumber ? `https://www.fema.gov/disaster/${r.disasterNumber}` : null;
    candidates.push({
      type: femaCategory(r.incidentType),
      subtype: `FEMA ${kind}${incident ? ` — ${incident}` : ""}`,
      title: clip(`${stateName}: ${name} (FEMA ${id})`),
      summary: clip(
        `FEMA ${kind} ${id} for ${stateName} on ${ts.slice(0, 10)}${incident ? ` (${incident.toLowerCase()})` : ""}${begin ? `, incident period from ${begin}` : ""}.` +
          `${areas.length ? ` Designated areas (${areas.length}): ${areas.slice(0, 8).join(", ")}${areas.length > 8 ? ", …" : ""}.` : ""}` +
          `${programs.length ? ` Programs: ${programs.join(", ")}.` : ""} Shown at the state's centre (region precision).`,
        1990,
      ),
      description: null,
      latitude: loc.lat,
      longitude: loc.lon,
      geoPrecision: loc.precision === "city" ? "region" : loc.precision,
      locationName: `${stateName}, United States`,
      country: "US",
      timestamp: ts,
      metrics: {
        declaration: id,
        disaster_number: r.disasterNumber ?? null,
        declaration_type: kind,
        incident_type: incident,
        designated_areas: areas.length,
        individual_assistance: Boolean(r.iaProgramDeclared || r.ihProgramDeclared),
        public_assistance: Boolean(r.paProgramDeclared),
        tribal: Boolean(r.tribalRequest),
      },
      entities: [
        { type: "ORGANIZATION", name: "Federal Emergency Management Agency", code: "FEMA" },
        { type: "LOCATION", name: stateName!, code: stateCode },
      ],
      source: makeSource({
        dataSourceId: "fema-declarations",
        externalId: id,
        sourceName: "FEMA — disaster declarations",
        sourceUrl: link,
        title: declTitle,
        publishedAt: ts,
        retrievedAt: ctx.retrievedAt,
        basis: "U.S. federal agency (FEMA, OpenFEMA dataset)",
      }),
      rawData: { declaration: id, disasterNumber: r.disasterNumber ?? null, state: stateCode, declarationDate: r.declarationDate, rows: rows.length },
    });
  }
  return { candidates, skipped };
}

export const femaDeclarationsConnector: DataSourceConnector<FemaRaw> = {
  id: "fema-declarations",
  name: "FEMA disaster declarations",
  description: "U.S. major disaster, emergency and fire management declarations from the last 30 days, one per declaration, at the state.",
  homepage: "https://www.fema.gov/openfema-data-page/disaster-declarations-summaries-v2",
  attribution: "FEMA OpenFEMA — U.S. government data; FEMA asks users not to imply endorsement and to note the data's update date",
  sourceType: "OFFICIAL_AGENCY",
  categories: ["DISASTER", "WEATHER", "FLOOD", "FIRE", "EARTHQUAKE", "HEALTH"],
  refreshIntervalMs: 60 * 60_000,
  timeoutMs: 30_000,
  mode: "live",
  fetch: fetchFema,
  parse: parseFema,
};
