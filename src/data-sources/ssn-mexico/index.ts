/**
 * Mexico's Servicio Sismológico Nacional (SSN, UNAM) "últimos sismos" RSS feed —
 * the latest ~15 located earthquakes. Times are "Hora de México" (central Mexico,
 * UTC−6 all year since DST was abolished in 2022) and are converted to UTC
 * (checked against EMSC: 04:23:38 local = 10:23:38Z). The feed is HTTP only.
 */
import type { EventCandidateInput } from "@/types/events";
import { httpGet, plainText, safeUrl, type DataSourceConnector, type FetchContext, type ParseContext, type ParseResult } from "../types";
import { localWallTime, magnitudeOf, quakeCandidate, validLatLon } from "../quake-common";

const MEXICO_OFFSET_H = -6;

export async function fetchSsnMexico(ctx: FetchContext): Promise<string> {
  const res = await httpGet("http://www.ssn.unam.mx/rss/ultimos-sismos.xml", ctx, { accept: "application/rss+xml, application/xml, text/xml" });
  return res.text();
}

const tag = (item: string, name: string) => {
  const m = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, "i").exec(item);
  return m ? m[1].replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, "$1").trim() : null;
};

/** "Fecha:2026-10-06 04:58:47 (Hora de México)" → UTC Date */
export function ssnTime(description: string): Date | null {
  const m = /(\d{4})-(\d{2})-(\d{2})\s+(\d{1,2}):(\d{2}):(\d{2})/.exec(description);
  if (!m) return null;
  return localWallTime(+m[1], +m[2], +m[3], +m[4], +m[5], +m[6], MEXICO_OFFSET_H);
}

/** "46 km al SURESTE de  SAYULA DE ALEMAN, VER" → "46 km al sureste de Sayula de Aleman, VER" */
export function ssnPlace(s: string): string | null {
  const t = s.replace(/\s+/g, " ").trim();
  const m = /^(\d+(?:\.\d+)?\s*km)\s+al\s+(\S+)\s+de\s+(.+?)(,\s*[A-Z.]+)?$/i.exec(t);
  if (!m) return t || null;
  const town = m[3].toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (_x, a: string, b: string) => a + b.toUpperCase()).replace(/ (De|Del|La|Las|Los|El|Y) /g, (w) => w.toLowerCase());
  return `${m[1]} al ${m[2].toLowerCase()} de ${town}${m[4] ?? ""}`;
}

export function parseSsnMexico(xml: string, ctx: ParseContext): ParseResult {
  const candidates: EventCandidateInput[] = [];
  let skipped = 0;
  for (const [, item] of xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)) {
    const title = plainText(tag(item, "title"), 300);
    const desc = plainText(tag(item, "description"), 500);
    const lat = Number(tag(item, "geo:lat")), lon = Number(tag(item, "geo:long"));
    const when = ssnTime(desc);
    if (!when || !validLatLon(lat, lon)) {
      skipped++;
      continue;
    }
    // Title: "3.4, 46 km al SURESTE de SAYULA DE ALEMAN, VER"
    const comma = title.indexOf(",");
    const magnitude = magnitudeOf(comma > 0 ? title.slice(0, comma) : "");
    const place = ssnPlace(comma > 0 ? title.slice(comma + 1) : title);
    const depth = /Profundidad:\s*([\d.]+)/i.exec(desc);
    const externalId = `${when.toISOString().slice(0, 19).replace(/\D/g, "")}_${lat.toFixed(2)}_${lon.toFixed(2)}`;
    candidates.push(
      quakeCandidate({
        dataSourceId: "ssn-mexico",
        externalId,
        sourceName: "Servicio Sismológico Nacional (SSN, UNAM) — Mexico",
        agency: "Mexico's National Seismological Service (SSN)",
        sourceUrl: safeUrl(tag(item, "link")) ?? "http://www.ssn.unam.mx/",
        credibilityBasis: "Mexico's national seismological service, operated by UNAM",
        assertion: "OFFICIAL_PRELIMINARY",
        when,
        retrievedAt: ctx.retrievedAt,
        latitude: lat,
        longitude: lon,
        magnitude,
        depthKm: depth ? Number(depth[1]) : null,
        place: place ? `${place}, México` : null,
        rawData: { title, description: desc },
      }),
    );
  }
  return { candidates, skipped };
}

export const ssnMexicoConnector: DataSourceConnector<string> = {
  id: "ssn-mexico",
  name: "SSN earthquakes (Mexico)",
  description: "The latest located earthquakes from Mexico's Servicio Sismológico Nacional (UNAM), including small quakes below the USGS/EMSC thresholds.",
  homepage: "http://www.ssn.unam.mx/",
  attribution: "Servicio Sismológico Nacional, Instituto de Geofísica, UNAM — attribution required",
  sourceType: "OFFICIAL_AGENCY",
  categories: ["EARTHQUAKE"],
  refreshIntervalMs: 5 * 60_000,
  mode: "live",
  fetch: fetchSsnMexico,
  parse: parseSsnMexico,
};
