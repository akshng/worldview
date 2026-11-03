/**
 * U.S. river gauges in moderate or major flood, from the NOAA/NWS National Water Prediction
 * Service observed river stages layer (keyless ArcGIS MapServer, `water/riv_gauges` layer 0).
 * One event per gauge and flood category at the gauge location; a change of category
 * supersedes the record for the previous one. Observation times are UTC.
 */
import type { EventCandidateInput } from "@/types/events";
import { usStateName } from "@/lib/geo/gazetteer";
import { httpGet, plainText, safeUrl, type DataSourceConnector, type FetchContext, type ParseContext, type ParseResult } from "../types";
import { clip, makeSource } from "../official-common";

export interface GaugeAttributes {
  gaugelid?: string;
  status?: string;
  location?: string;
  waterbody?: string;
  state?: string;
  obstime?: string;
  wfo?: string;
  url?: string;
  units?: string;
  action?: string;
  flood?: string;
  moderate?: string;
  major?: string;
  observed?: string;
  secvalue?: string;
  secunit?: string;
  latitude?: number;
  longitude?: number;
}
export interface RiverRaw {
  features: Array<{ attributes?: GaugeAttributes }>;
}

const URL_ =
  "https://mapservices.weather.noaa.gov/eventdriven/rest/services/water/riv_gauges/MapServer/0/query?where=status+IN+(%27major%27,%27moderate%27)&outFields=*&returnGeometry=false&f=json";
const MAX_AGE_MS = 2 * 86_400_000;
const LEVELS = ["moderate", "major"] as const;

export async function fetchRiver(ctx: FetchContext): Promise<RiverRaw> {
  const json = (await (await httpGet(URL_, ctx)).json()) as { features?: RiverRaw["features"]; error?: { message?: string } };
  if (json.error) throw new Error(`NWPS river gauges: ${json.error.message ?? "query error"}`);
  return { features: Array.isArray(json.features) ? json.features : [] };
}

/** "2026-11-03 01:30:00" (UTC) → ISO. */
function obsTime(s: string | undefined): string | null {
  if (!s) return null;
  const t = Date.parse(`${s.trim().replace(" ", "T")}Z`);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}
const num = (s: string | undefined) => {
  const n = Number.parseFloat(s ?? "");
  return Number.isFinite(n) ? n : null;
};

export function parseRiver(raw: RiverRaw, ctx: ParseContext): ParseResult {
  const candidates: EventCandidateInput[] = [];
  let skipped = 0;
  for (const { attributes: a } of raw.features ?? []) {
    const status = (a?.status ?? "").toLowerCase() as (typeof LEVELS)[number];
    const lid = (a?.gaugelid ?? "").trim().toUpperCase();
    const ts = obsTime(a?.obstime);
    const lat = a?.latitude, lon = a?.longitude;
    if (!a || !LEVELS.includes(status) || !/^[A-Z0-9]{3,6}$/.test(lid) || !ts || ctx.now - Date.parse(ts) > MAX_AGE_MS || typeof lat !== "number" || typeof lon !== "number" || !Number.isFinite(lat) || !Number.isFinite(lon)) {
      skipped++;
      continue;
    }
    const river = plainText(a.waterbody, 100) || "River";
    const place = plainText(a.location, 100) || lid;
    const state = a.state ? usStateName(a.state) : null;
    const units = plainText(a.units, 10) || "ft";
    const observed = num(a.observed), flood = num(a.flood), moderate = num(a.moderate), major = num(a.major);
    const flow = num(a.secvalue);
    const label = status === "major" ? "Major" : "Moderate";
    const stages = [flood !== null ? `flood stage ${flood} ${units}` : null, moderate !== null ? `moderate ${moderate} ${units}` : null, major !== null ? `major ${major} ${units}` : null].filter(Boolean);
    candidates.push({
      type: "FLOOD",
      subtype: `river flooding — ${status}`,
      title: clip(`${label} flooding: ${river} at ${place}${a.state ? `, ${a.state}` : ""}`),
      summary: clip(
        `The NWS reports ${status} flooding at gauge ${lid} (${river} at ${place}${state ? `, ${state}` : ""}): observed ${observed !== null ? `${observed} ${units}` : "stage n/a"}` +
          `${flow !== null && a.secunit ? ` (${flow} ${a.secunit})` : ""} at ${ts.slice(0, 16).replace("T", " ")} UTC${stages.length ? `; ${stages.join(", ")}` : ""}.` +
          `${a.wfo ? ` Forecast office ${a.wfo.toUpperCase()}.` : ""} Shown at the gauge.`,
        1990,
      ),
      description: null,
      latitude: lat,
      longitude: lon,
      geoPrecision: "exact",
      locationName: `${place}${state ? `, ${state}` : ""} (${river})`,
      country: "US",
      timestamp: ts,
      metrics: { gauge: lid, flood_category: status, observed_stage: observed, flood_stage: flood, moderate_stage: moderate, major_stage: major, units, flow: flow, flow_units: a.secunit || null },
      entities: [{ type: "ORGANIZATION", name: "National Weather Service", code: "NWS" }],
      supersedes: LEVELS.filter((l) => l !== status).map((l) => `river-flooding:${lid}:${l}`),
      source: makeSource({
        dataSourceId: "river-flooding",
        externalId: `${lid}:${status}`,
        sourceName: "NOAA National Water Prediction Service",
        sourceUrl: safeUrl(a.url) ?? `https://water.noaa.gov/gauges/${lid.toLowerCase()}`,
        title: null,
        publishedAt: ts,
        retrievedAt: ctx.retrievedAt,
        assertion: "MEASUREMENT",
        basis: "U.S. federal agency (NOAA National Weather Service) river gauge observation",
      }),
      rawData: { gauge: lid, status, obstime: a.obstime, observed: a.observed },
    });
  }
  return { candidates, skipped };
}

export const riverFloodingConnector: DataSourceConnector<RiverRaw> = {
  id: "river-flooding",
  name: "U.S. river flooding (NWPS gauges)",
  description: "U.S. river gauges currently observed in moderate or major flood (NOAA National Water Prediction Service), at the gauge.",
  homepage: "https://water.noaa.gov/",
  attribution: "NOAA National Weather Service / National Water Prediction Service — public domain U.S. government data",
  sourceType: "OFFICIAL_AGENCY",
  categories: ["FLOOD"],
  refreshIntervalMs: 15 * 60_000,
  timeoutMs: 30_000,
  mode: "live",
  fetch: fetchRiver,
  parse: parseRiver,
};
