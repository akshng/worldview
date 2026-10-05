import type { EventCandidateInput } from "@/types/events";
import { safeUrl, type ParseContext, type ParseResult } from "../types";
import type { UsgsFeed } from "./types";

export const USGS_SOURCE_NAME = "USGS Earthquake Hazards Program";

export function parseUsgsFeed(feed: UsgsFeed, ctx: ParseContext): ParseResult {
  const candidates: EventCandidateInput[] = [];
  let skipped = 0;
  for (const f of feed.features ?? []) {
    const p = f.properties;
    const coords = f.geometry?.coordinates;
    // Only natural earthquakes; skip blasts/explosions and deleted solutions.
    if (!p || !coords || p.type !== "earthquake" || p.status === "deleted" || p.mag === null) {
      skipped++;
      continue;
    }
    const [lon, lat, depth] = coords;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      skipped++;
      continue;
    }
    const mag = Math.round(p.mag * 10) / 10;
    const place = p.place?.trim() || null;
    const when = new Date(p.time).toISOString();
    const reviewed = p.status === "reviewed";
    const summary =
      `USGS reports a magnitude ${mag.toFixed(1)}${p.magType ? ` (${p.magType})` : ""} earthquake` +
      `${place ? ` ${/^\d/.test(place) ? "" : "located "}${place}` : ""}` +
      ` at a depth of ${Math.round(depth)} km, at ${when.replace("T", " ").slice(0, 16)} UTC. ` +
      `Solution status: ${p.status}.` +
      (p.tsunami === 1 ? " USGS flags this event for tsunami information (not itself a warning)." : "") +
      (p.alert ? ` PAGER alert level: ${p.alert}.` : "");

    candidates.push({
      type: "EARTHQUAKE",
      subtype: "earthquake",
      title: `M ${mag.toFixed(1)} earthquake${place ? ` — ${place}` : ""}`,
      summary,
      latitude: lat,
      longitude: lon,
      geoPrecision: "exact",
      locationName: place,
      timestamp: when,
      metrics: {
        magnitude: mag,
        magnitude_type: p.magType,
        depth_km: Math.round(depth * 10) / 10,
        tsunami: p.tsunami === 1,
        alert_level: p.alert,
        felt_reports: p.felt,
        usgs_significance: p.sig,
      },
      entities: [{ type: "ORGANIZATION", name: "USGS", code: null }],
      source: {
        id: `usgs:${f.id}`,
        dataSourceId: "usgs",
        externalId: f.id,
        sourceName: USGS_SOURCE_NAME,
        sourceUrl: safeUrl(p.url),
        title: p.title,
        titleIsDerived: false,
        publishedAt: new Date(p.updated).toISOString(),
        retrievedAt: ctx.retrievedAt,
        sourceType: "OFFICIAL_AGENCY",
        assertion: reviewed ? "OFFICIAL_FINAL" : "OFFICIAL_PRELIMINARY",
        credibility: { basis: "U.S. federal scientific agency (U.S. Geological Survey)" },
      },
      rawData: { id: f.id, ...p, coordinates: coords },
    });
  }
  return { candidates, skipped };
}
