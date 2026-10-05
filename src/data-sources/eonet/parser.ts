import type { EventCandidateInput, EventCategory } from "@/types/events";
import { plainText, safeUrl, type ParseContext, type ParseResult } from "../types";
import type { EonetGeometry, EonetResponse } from "./types";

const CATEGORY: Record<string, { type: EventCategory; subtype: string }> = {
  wildfires: { type: "FIRE", subtype: "wildfire" },
  severeStorms: { type: "WEATHER", subtype: "severe-storm" },
  volcanoes: { type: "VOLCANO", subtype: "volcano" },
  floods: { type: "FLOOD", subtype: "flood" },
  earthquakes: { type: "EARTHQUAKE", subtype: "earthquake" },
  drought: { type: "DISASTER", subtype: "drought" },
  dustHaze: { type: "WEATHER", subtype: "dust-haze" },
  landslides: { type: "DISASTER", subtype: "landslide" },
  tempExtremes: { type: "WEATHER", subtype: "temperature-extreme" },
  snow: { type: "WEATHER", subtype: "snow" },
  seaLakeIce: { type: "OTHER", subtype: "sea-lake-ice" },
  waterColor: { type: "OTHER", subtype: "water-color" },
  manmade: { type: "INFRASTRUCTURE", subtype: "manmade" },
};

const SOURCE_NAMES: Record<string, string> = {
  JTWC: "Joint Typhoon Warning Center",
  NHC: "NOAA National Hurricane Center",
  IRWIN: "IRWIN (U.S. interagency wildfire)",
  InciWeb: "InciWeb",
  SIVolcano: "Smithsonian Global Volcanism Program",
  GDACS: "GDACS",
  NATICE: "U.S. National Ice Center",
  BYU_ICE: "BYU Antarctic Iceberg Tracking",
  EO: "NASA Earth Observatory",
  PDC: "Pacific Disaster Center",
  CALFIRE: "CAL FIRE",
};

function point(g: EonetGeometry): [number, number] | null {
  if (g.type === "Point") {
    const [lon, lat] = g.coordinates as number[];
    return Number.isFinite(lat) && Number.isFinite(lon) ? [lon, lat] : null;
  }
  const ring = (g.coordinates as number[][][])[0] ?? [];
  if (!ring.length) return null;
  const s = ring.reduce((a, [x, y]) => [a[0] + x, a[1] + y], [0, 0]);
  return [s[0] / ring.length, s[1] / ring.length];
}

export function parseEonet(res: EonetResponse, ctx: ParseContext): ParseResult {
  const candidates: EventCandidateInput[] = [];
  let skipped = 0;
  for (const e of res.events ?? []) {
    const cat = CATEGORY[e.categories?.[0]?.id ?? ""];
    const geoms = [...(e.geometry ?? [])].sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
    const last = geoms[geoms.length - 1];
    const p = last ? point(last) : null;
    if (!cat || !p) {
      skipped++;
      continue;
    }
    const upstream = e.sources?.[0];
    const upstreamName = upstream ? (SOURCE_NAMES[upstream.id] ?? upstream.id) : null;
    const metrics: Record<string, number | string | boolean | null> = { started_at: new Date(geoms[0].date).toISOString(), observations: geoms.length };
    if (last.magnitudeValue !== null && last.magnitudeUnit) {
      if (last.magnitudeUnit === "kts") metrics.wind_kts = last.magnitudeValue;
      else if (last.magnitudeUnit === "acres") metrics.area_km2 = Math.round(last.magnitudeValue * 0.00404686 * 10) / 10;
      else if (/NM\^2|nm2/i.test(last.magnitudeUnit)) metrics.area_km2 = Math.round(last.magnitudeValue * 3.4299);
      else metrics[`magnitude_${last.magnitudeUnit.toLowerCase().replace(/\W+/g, "_")}`] = last.magnitudeValue;
    }
    const title = plainText(e.title, 200);
    candidates.push({
      type: cat.type,
      subtype: cat.subtype,
      title,
      summary:
        `NASA EONET lists an open ${e.categories[0].title.toLowerCase()} event: “${title}”` +
        `${upstreamName ? `, sourced from ${upstreamName}` : ""}. Latest position/observation ${new Date(last.date).toISOString().slice(0, 16).replace("T", " ")} UTC` +
        `${metrics.wind_kts ? `, ${metrics.wind_kts} kt winds` : ""}${metrics.area_km2 ? `, ~${metrics.area_km2} km²` : ""}.`,
      description: plainText(e.description, 1000) || null,
      latitude: p[1],
      longitude: p[0],
      geoPrecision: last.type === "Point" ? "exact" : "region",
      locationName: null,
      timestamp: new Date(last.date).toISOString(),
      resolvedAt: e.closed ? new Date(e.closed).toISOString() : null,
      metrics,
      entities: [],
      source: {
        id: `eonet:${e.id}`,
        dataSourceId: "eonet",
        externalId: e.id,
        sourceName: upstreamName ? `NASA EONET via ${upstreamName}` : "NASA EONET",
        sourceUrl: safeUrl(upstream?.url) ?? safeUrl(e.link),
        title,
        titleIsDerived: false,
        publishedAt: new Date(last.date).toISOString(),
        retrievedAt: ctx.retrievedAt,
        sourceType: "SCIENTIFIC",
        assertion: "OFFICIAL_PRELIMINARY",
        credibility: { basis: "NASA curated natural-event catalogue" },
      },
      rawData: { id: e.id, link: e.link, categories: e.categories, sources: e.sources, observations: geoms.length },
    });
  }
  return { candidates, skipped };
}
