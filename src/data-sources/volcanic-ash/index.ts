/**
 * Volcanic ash SIGMETs worldwide, from the NOAA Aviation Weather Center international SIGMET
 * API (keyless). Each SIGMET is issued by the meteorological watch office of the flight
 * information region the ash cloud is in, and names the volcano and its position (PSN).
 *
 * One event per volcano per UTC day (successive SIGMETs and neighbouring FIRs update it), at
 * the volcano's reported position, with the latest observed ash-cloud polygon. Forecast-only
 * duplicates ("…F" series) are skipped. Merges downstream with other volcano sources.
 */
import type { AreaGeometry, EventCandidateInput } from "@/types/events";
import { httpGet, plainText, type DataSourceConnector, type FetchContext, type ParseContext, type ParseResult } from "../types";
import { clip, makeSource } from "../official-common";

export interface IntlSigmet {
  icaoId: string;
  firId: string;
  firName?: string | null;
  receiptTime: string;
  validTimeFrom: number;
  validTimeTo: number;
  seriesId: string;
  hazard: string;
  qualifier?: string | null;
  base?: number | null;
  top?: number | null;
  coords?: Array<{ lat: number; lon: number }> | null;
  dir?: string | null;
  spd?: string | null;
  rawSigmet: string;
}
export type VolcanicAshRaw = IntlSigmet[];

const API = "https://aviationweather.gov/api/data/isigmet?format=json&hazard=va";
const MAX_AGE_MS = 36 * 3_600_000;

export async function fetchVolcanicAsh(ctx: FetchContext): Promise<VolcanicAshRaw> {
  const j = (await (await httpGet(API, ctx)).json()) as unknown;
  return Array.isArray(j) ? (j as VolcanicAshRaw) : [];
}

const flat = (s: string) => s.replace(/\s+/g, " ").trim();

/** "… FIR VA ERUPTION MT SAKURAJIMA (AIRA CALDERA) PSN N3136 E13039 …" → "Sakurajima (Aira Caldera)" */
export function volcanoName(raw: string, qualifier?: string | null): string | null {
  const m = flat(raw).match(/\bVA\s+(?:ERUPTION\s+)?((?:MT\s+|VOLCAN\s+|VOLCANO\s+)*)(.+?)\s+PSN\b/);
  const name = (m?.[2] ?? qualifier?.replace(/^(ERUPTION\s+)?(MT\s+|VOLCAN\s+)*/i, "") ?? "").trim();
  if (!name || name.length < 3 || /^(MT|ERUPTION)$/i.test(name)) return null;
  return name
    .toLowerCase()
    .replace(/(^|[\s(/-])(\p{L})/gu, (_m, a: string, b: string) => a + b.toUpperCase())
    .replace(/(?<=\s)(De|Del|La|Las|Los|El)(?=\s)/g, (w) => w.toLowerCase());
}

/** "PSN N1428 W09052" → { lat: 14.467, lon: -90.867 } */
export function volcanoPosition(raw: string): { lat: number; lon: number } | null {
  const m = flat(raw).match(/\bPSN\s+([NS])(\d{2})(\d{2})?\s+([EW])(\d{3})(\d{2})?\b/);
  if (!m) return null;
  const lat = (Number(m[2]) + Number(m[3] ?? 0) / 60) * (m[1] === "S" ? -1 : 1);
  const lon = (Number(m[5]) + Number(m[6] ?? 0) / 60) * (m[4] === "W" ? -1 : 1);
  return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat: Math.round(lat * 1000) / 1000, lon: Math.round(lon * 1000) / 1000 } : null;
}

function polygon(coords: IntlSigmet["coords"]): AreaGeometry | null {
  const ring = (coords ?? []).filter((c) => Number.isFinite(c.lat) && Number.isFinite(c.lon)).map((c) => [c.lon, c.lat] as [number, number]);
  if (ring.length < 3) return null;
  const [a, z] = [ring[0], ring[ring.length - 1]];
  if (a[0] !== z[0] || a[1] !== z[1]) ring.push(a);
  return ring.length >= 4 ? { type: "Polygon", coordinates: [ring] } : null;
}

export function parseVolcanicAsh(raw: VolcanicAshRaw, ctx: ParseContext): ParseResult {
  let skipped = 0;
  const groups = new Map<string, Array<IntlSigmet & { name: string; pos: { lat: number; lon: number } }>>();
  for (const s of raw ?? []) {
    const from = Number(s.validTimeFrom) * 1000;
    const name = s.rawSigmet ? volcanoName(s.rawSigmet, s.qualifier) : null;
    const pos = s.rawSigmet ? volcanoPosition(s.rawSigmet) : null;
    if (s.hazard !== "VA" || /F$/i.test(s.seriesId ?? "") || !name || !pos || !Number.isFinite(from) || ctx.now - from > MAX_AGE_MS) {
      skipped++;
      continue;
    }
    const key = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}:${new Date(from).toISOString().slice(0, 10)}`;
    groups.set(key, [...(groups.get(key) ?? []), { ...s, name, pos }]);
  }
  const candidates: EventCandidateInput[] = [];
  for (const [key, list] of groups) {
    list.sort((a, b) => a.validTimeFrom - b.validTimeFrom || a.receiptTime.localeCompare(b.receiptTime));
    const first = list[0];
    const last = list[list.length - 1];
    skipped += list.length - 1;
    const top = Math.max(...list.map((s) => Number(s.top) || 0));
    const fl = top > 0 ? `FL${String(Math.round(top / 100)).padStart(3, "0")}` : null;
    const firs = [...new Set(list.map((s) => plainText(s.firName ?? s.firId, 80)))];
    const ts = new Date(first.validTimeFrom * 1000).toISOString();
    const until = new Date(Math.max(...list.map((s) => s.validTimeTo)) * 1000).toISOString();
    const title = clip(`Volcanic ash SIGMET: ${last.name}${fl ? ` — ash cloud up to ${fl}` : ""} (${firs[0]})`);
    candidates.push({
      type: "VOLCANO",
      subtype: "volcanic ash advisory",
      title,
      summary:
        `${list.length} volcanic ash SIGMET${list.length > 1 ? "s" : ""} issued for ${last.name} (${firs.join("; ")}) since ${ts.slice(11, 16)} UTC, latest valid until ${until.slice(0, 16).replace("T", " ")} UTC.` +
        `${fl ? ` Highest reported ash top ${fl} (${top.toLocaleString("en-US")} ft).` : ""}${last.dir ? ` Moving ${last.dir}${last.spd ? ` at ${last.spd} kt` : ""}.` : ""} Aviation hazard advisory; shown at the volcano position given in the SIGMET.`,
      description: plainText(last.rawSigmet, 2000),
      latitude: last.pos.lat,
      longitude: last.pos.lon,
      geoPrecision: "exact",
      geometry: polygon(last.coords),
      locationName: `${last.name} volcano`,
      timestamp: ts,
      metrics: { ash_top_ft: top || null, flight_level: fl, sigmets: list.length, valid_until: until, issuing_office: last.icaoId },
      entities: [{ type: "LOCATION", name: `${last.name} volcano`, code: null }],
      source: makeSource({
        dataSourceId: "volcanic-ash",
        externalId: key,
        sourceName: `Volcanic ash SIGMET — ${plainText(last.icaoId, 8)} via NOAA Aviation Weather Center`,
        sourceUrl: API,
        title,
        publishedAt: new Date(last.receiptTime).toISOString(),
        retrievedAt: ctx.retrievedAt,
        assertion: "OFFICIAL_PRELIMINARY",
        basis: "ICAO SIGMET issued by the national meteorological watch office, distributed by NOAA AWC",
      }),
      rawData: { firs: list.map((s) => s.firId), series: list.map((s) => s.seriesId), receipt: last.receiptTime },
    });
  }
  return { candidates, skipped };
}

export const volcanicAshConnector: DataSourceConnector<VolcanicAshRaw> = {
  id: "volcanic-ash",
  name: "Volcanic ash SIGMETs",
  description: "Volcanic ash SIGMETs worldwide (NOAA Aviation Weather Center international SIGMETs): one event per volcano per day at the volcano, with the ash-cloud polygon.",
  homepage: "https://aviationweather.gov/data/api/",
  attribution: "NOAA Aviation Weather Center — public domain; SIGMETs issued by national meteorological watch offices",
  sourceType: "OFFICIAL_AGENCY",
  categories: ["VOLCANO", "AVIATION"],
  refreshIntervalMs: 15 * 60_000,
  mode: "live",
  fetch: fetchVolcanicAsh,
  parse: parseVolcanicAsh,
};
