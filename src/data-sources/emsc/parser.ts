import type { EventCandidateInput } from "@/types/events";
import type { ParseContext, ParseResult } from "../types";
import type { EmscFeed } from "./types";

export const EMSC_SOURCE_NAME = "European-Mediterranean Seismological Centre (EMSC)";

/** "NEW BRITAIN REGION, P.N.G." → "New Britain Region, P.N.G." */
export function titleCaseRegion(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b([a-z])([a-z]*)/g, (_m, a: string, b: string) => a.toUpperCase() + b)
    .replace(/\b(Of|And|The)\b/g, (w) => w.toLowerCase())
    .replace(/\b([A-Z])\.([a-z])\./gi, (w) => w.toUpperCase());
}

export function parseEmsc(feed: EmscFeed, ctx: ParseContext): ParseResult {
  const candidates: EventCandidateInput[] = [];
  let skipped = 0;
  for (const f of feed.features ?? []) {
    const p = f.properties;
    // "ke" = known earthquake; skip explosions, quarry blasts, induced events etc.
    if (!p || p.mag === null || !Number.isFinite(p.lat) || !Number.isFinite(p.lon) || (p.evtype && p.evtype !== "ke")) {
      skipped++;
      continue;
    }
    const mag = Math.round(p.mag * 10) / 10;
    const region = p.flynn_region ? titleCaseRegion(p.flynn_region) : null;
    const when = new Date(p.time).toISOString();
    const depth = Math.abs(p.depth ?? 0);
    candidates.push({
      type: "EARTHQUAKE",
      subtype: "earthquake",
      title: `M ${mag.toFixed(1)} earthquake${region ? ` — ${region}` : ""}`,
      summary:
        `EMSC reports a magnitude ${mag.toFixed(1)}${p.magtype ? ` (${p.magtype})` : ""} earthquake${region ? ` in the ${region} area` : ""}` +
        ` at a depth of ${Math.round(depth)} km, at ${when.replace("T", " ").slice(0, 16)} UTC.` +
        (p.auth ? ` Solution by ${p.auth}.` : ""),
      latitude: p.lat,
      longitude: p.lon,
      geoPrecision: "exact",
      locationName: region,
      timestamp: when,
      metrics: { magnitude: mag, magnitude_type: p.magtype ?? null, depth_km: Math.round(depth * 10) / 10 },
      entities: [{ type: "ORGANIZATION", name: "EMSC", code: null }],
      source: {
        id: `emsc:${p.unid}`,
        dataSourceId: "emsc",
        externalId: p.unid,
        sourceName: EMSC_SOURCE_NAME,
        sourceUrl: `https://www.seismicportal.eu/eventdetails.html?unid=${encodeURIComponent(p.unid)}`,
        title: null,
        titleIsDerived: true,
        publishedAt: new Date(p.lastupdate ?? p.time).toISOString(),
        retrievedAt: ctx.retrievedAt,
        sourceType: "SCIENTIFIC",
        // EMSC publishes rapid automatic/manual solutions; treat as preliminary.
        assertion: "OFFICIAL_PRELIMINARY",
        credibility: { basis: "Non-profit seismological centre aggregating ~70 national institutes (EMSC-CSEM)" },
      },
      rawData: { unid: p.unid, auth: p.auth, evtype: p.evtype, lastupdate: p.lastupdate },
    });
  }
  return { candidates, skipped };
}
