/**
 * FAA Temporary Flight Restrictions (keyless): the TFR list API (`tfrapi/exportTfrList`: NOTAM
 * number, type, description) joined with the TFR GeoServer WFS layer `TFR:V_TFR_LOC` (one
 * polygon per restricted area, last-modification time). One event per NOTAM with its polygon(s)
 * — VIP movements, security areas, disasters/hazards (fires, recovery operations), space
 * operations, air shows and stadium events.
 *
 * Standing restrictions (border and military security areas that run for months) are skipped
 * when the NOTAM was last modified more than 30 days ago.
 */
import type { AreaGeometry, EventCandidateInput } from "@/types/events";
import { usStateName } from "@/lib/geo/gazetteer";
import { httpGet, plainText, type DataSourceConnector, type FetchContext, type ParseContext, type ParseResult } from "../types";
import { clip, makeSource } from "../official-common";
import { polygonCentroid, simplifyArea } from "../weather/parser";

export interface TfrListItem {
  notam_id?: string;
  type?: string;
  facility?: string;
  state?: string;
  description?: string;
  creation_date?: string;
}
export interface TfrFeature {
  id?: string;
  geometry?: { type: string; coordinates: unknown } | null;
  properties?: { NOTAM_KEY?: string; TITLE?: string; LAST_MODIFICATION_DATETIME?: string; STATE?: string; LEGAL?: string; CNS_LOCATION_ID?: string };
}
export interface TfrRaw {
  list: TfrListItem[];
  features: TfrFeature[];
}

const LIST_URL = "https://tfr.faa.gov/tfrapi/exportTfrList";
const WFS_URL =
  "https://tfr.faa.gov/geoserver/TFR/ows?service=WFS&version=1.1.0&request=GetFeature&typeName=TFR:V_TFR_LOC&maxFeatures=1000&outputFormat=application/json&srsname=EPSG:4326";
const STANDING_MS = 30 * 86_400_000;

export async function fetchTfr(ctx: FetchContext): Promise<TfrRaw> {
  const [list, wfs] = await Promise.all([
    httpGet(LIST_URL, ctx).then((r) => r.json() as Promise<unknown>),
    httpGet(WFS_URL, ctx).then((r) => r.json() as Promise<{ features?: TfrFeature[] }>),
  ]);
  return { list: Array.isArray(list) ? (list as TfrListItem[]) : [], features: Array.isArray(wfs.features) ? wfs.features : [] };
}

/** "202609281952" (UTC) → ISO. */
export function tfrModified(s: string | undefined): string | null {
  const m = s?.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})$/);
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5])).toISOString() : null;
}

/** "11/02/2026" → ISO midnight UTC. */
function listDate(s: string | undefined): string | null {
  const m = s?.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return m ? new Date(Date.UTC(+m[3], +m[1] - 1, +m[2])).toISOString() : null;
}

const SUBTYPE: Record<string, string> = {
  VIP: "VIP movement",
  SECURITY: "security",
  HAZARDS: "hazard / disaster area",
  "SPACE OPERATIONS": "space operations",
  "AIR SHOWS/SPORTS": "air show / sporting event",
  "UAS PUBLIC GATHERING": "drone restriction (public gathering)",
  SPECIAL: "special",
};

type Ring = [number, number][];
function polygonsOf(g: TfrFeature["geometry"]): Ring[][] {
  if (!g) return [];
  if (g.type === "Polygon" && Array.isArray(g.coordinates)) return [g.coordinates as Ring[]];
  if (g.type === "MultiPolygon" && Array.isArray(g.coordinates)) return g.coordinates as Ring[][];
  return [];
}

function bboxSpanDeg(polys: Ring[][]): number {
  let w = 180, e = -180, s = 90, n = -90;
  for (const p of polys) for (const [x, y] of p[0] ?? []) { w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y); }
  return Math.max(e - w, n - s);
}

export function parseTfr(raw: TfrRaw, ctx: ParseContext): ParseResult {
  const candidates: EventCandidateInput[] = [];
  let skipped = 0;
  const byNotam = new Map<string, { polys: Ring[][]; modified: string | null; title: string; legal: string }>();
  for (const f of raw.features ?? []) {
    const notam = (f.properties?.NOTAM_KEY?.split("-")[0] ?? f.id?.split(".")[1] ?? "").trim();
    if (!/^\d\/\d{1,5}$/.test(notam)) continue;
    const cur = byNotam.get(notam) ?? { polys: [], modified: null, title: plainText(f.properties?.TITLE, 200), legal: f.properties?.LEGAL ?? "" };
    cur.polys.push(...polygonsOf(f.geometry));
    const mod = tfrModified(f.properties?.LAST_MODIFICATION_DATETIME);
    if (mod && (!cur.modified || mod > cur.modified)) cur.modified = mod;
    byNotam.set(notam, cur);
  }
  const seen = new Set<string>();
  for (const it of raw.list ?? []) {
    const notam = (it.notam_id ?? "").trim();
    const area = byNotam.get(notam);
    const ts = area?.modified ?? listDate(it.creation_date);
    if (!/^\d\/\d{1,5}$/.test(notam) || seen.has(notam) || !area?.polys.length || !ts || ctx.now - Date.parse(ts) > STANDING_MS) {
      skipped++;
      continue;
    }
    seen.add(notam);
    const geometry: AreaGeometry = area.polys.length === 1 ? { type: "Polygon", coordinates: area.polys[0] } : { type: "MultiPolygon", coordinates: area.polys };
    const c = polygonCentroid(geometry as Parameters<typeof polygonCentroid>[0]);
    if (!c) {
      skipped++;
      continue;
    }
    const type = plainText(it.type, 40).toUpperCase() || area.legal.toUpperCase() || "OTHER";
    const subtype = SUBTYPE[type] ?? type.toLowerCase();
    const desc = plainText(it.description, 250) || area.title;
    const state = it.state ? usStateName(it.state) : null;
    const title = clip(`Flight restriction (${subtype}): ${desc}`);
    candidates.push({
      type: "AVIATION",
      subtype: `TFR — ${subtype}`,
      title,
      summary: clip(
        `FAA temporary flight restriction NOTAM FDC ${notam} (${type.toLowerCase()})${it.facility ? `, controlling facility ${it.facility}` : ""}: ${desc}. ` +
          `Last modified ${ts.slice(0, 16).replace("T", " ")} UTC. Shown with the restricted airspace (${area.polys.length} area${area.polys.length > 1 ? "s" : ""}); check the NOTAM for altitudes and exact times.`,
        1990,
      ),
      description: null,
      latitude: c[1],
      longitude: c[0],
      geoPrecision: bboxSpanDeg(area.polys) < 0.5 ? "exact" : "region",
      geometry: simplifyArea(geometry as Parameters<typeof simplifyArea>[0]),
      locationName: state ? `${desc.split(",")[0]}, ${state}` : desc.split(",").slice(0, 2).join(","),
      country: "US",
      timestamp: ts,
      metrics: { notam: `FDC ${notam}`, tfr_type: type, facility: it.facility ?? null, areas: area.polys.length },
      entities: [{ type: "ORGANIZATION", name: "Federal Aviation Administration", code: "FAA" }],
      source: makeSource({
        dataSourceId: "faa-tfr",
        externalId: notam,
        sourceName: "FAA Temporary Flight Restrictions",
        sourceUrl: `https://tfr.faa.gov/tfr3/?page=detail_${notam.replace("/", "_")}`,
        title: desc,
        publishedAt: ts,
        retrievedAt: ctx.retrievedAt,
        assertion: "OFFICIAL_FINAL",
        basis: "U.S. federal agency (FAA) — Flight Data Center NOTAM",
      }),
      rawData: { notam, type: it.type, facility: it.facility, state: it.state, modified: ts },
    });
  }
  return { candidates, skipped };
}

export const faaTfrConnector: DataSourceConnector<TfrRaw> = {
  id: "faa-tfr",
  name: "FAA temporary flight restrictions",
  description: "Current FAA TFRs (VIP movements, security areas, disaster/hazard areas, space operations, air shows and stadiums) with their restricted-airspace polygons; standing restrictions not modified in 30 days are skipped.",
  homepage: "https://tfr.faa.gov/",
  attribution: "Federal Aviation Administration — public domain U.S. government data; not for flight planning",
  sourceType: "OFFICIAL_AGENCY",
  categories: ["AVIATION"],
  refreshIntervalMs: 15 * 60_000,
  timeoutMs: 30_000,
  mode: "live",
  fetch: fetchTfr,
  parse: parseTfr,
};
