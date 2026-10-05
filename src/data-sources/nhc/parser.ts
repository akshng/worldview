import type { EventCandidateInput } from "@/types/events";
import { safeUrl, type ParseContext, type ParseResult } from "../types";
import type { NhcRaw } from "./types";

const CLASS: Record<string, string> = {
  TD: "Tropical depression",
  TS: "Tropical storm",
  HU: "Hurricane",
  STD: "Subtropical depression",
  STS: "Subtropical storm",
  PTC: "Potential tropical cyclone",
  PC: "Post-tropical cyclone",
  TY: "Typhoon",
};

/** Saffir-Simpson category from max sustained wind (kt). */
export function saffirSimpson(kt: number): number | null {
  if (kt >= 137) return 5;
  if (kt >= 113) return 4;
  if (kt >= 96) return 3;
  if (kt >= 83) return 2;
  if (kt >= 64) return 1;
  return null;
}

const COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];

export function parseNhc(raw: NhcRaw, ctx: ParseContext): ParseResult {
  const candidates: EventCandidateInput[] = [];
  let skipped = 0;
  for (const s of raw.activeStorms ?? []) {
    if (!Number.isFinite(s.latitudeNumeric) || !Number.isFinite(s.longitudeNumeric)) {
      skipped++;
      continue;
    }
    const kind = CLASS[s.classification] ?? "Tropical cyclone";
    const kt = s.intensity ? Number(s.intensity) : NaN;
    const cat = Number.isFinite(kt) ? saffirSimpson(kt) : null;
    const name = s.name.replace(/\b\w/g, (c) => c.toUpperCase());
    const mph = Number.isFinite(kt) ? Math.round(kt * 1.15078) : null;
    const moving =
      s.movementDir !== null && s.movementSpeed !== null
        ? ` Moving ${COMPASS[Math.round(((s.movementDir % 360) / 22.5)) % 16]} at ${s.movementSpeed} mph.`
        : "";
    const adv = s.publicAdvisory;
    candidates.push({
      type: "WEATHER",
      subtype: "tropical-cyclone",
      // "tropical cyclone" kept in the title so GDACS reports of the same storm merge.
      title: `${kind} ${name}${cat ? ` (Category ${cat})` : ""} — tropical cyclone`,
      summary:
        `The U.S. National Hurricane Center reports ${kind.toLowerCase()} ${name} near ${Math.abs(s.latitudeNumeric).toFixed(1)}°${s.latitudeNumeric >= 0 ? "N" : "S"}, ` +
        `${Math.abs(s.longitudeNumeric).toFixed(1)}°${s.longitudeNumeric >= 0 ? "E" : "W"}` +
        `${Number.isFinite(kt) ? ` with maximum sustained winds of ${kt} kt (${mph} mph)` : ""}` +
        `${s.pressure ? ` and minimum pressure ${s.pressure} mb` : ""}.${moving}` +
        `${adv ? ` Public advisory #${adv.advNum}.` : ""}`,
      latitude: s.latitudeNumeric,
      longitude: s.longitudeNumeric,
      // Storm centre at advisory time.
      geoPrecision: "approximate",
      locationName: null,
      timestamp: new Date(s.lastUpdate).toISOString(),
      metrics: {
        wind_kts: Number.isFinite(kt) ? kt : null,
        pressure_mb: s.pressure ? Number(s.pressure) : null,
        saffir_simpson: cat,
        classification: s.classification,
        movement_dir_deg: s.movementDir,
        movement_mph: s.movementSpeed,
        advisory: adv?.advNum ?? null,
      },
      entities: [{ type: "ORGANIZATION", name: "National Hurricane Center", code: "NHC" }],
      source: {
        // One record per storm, updated with each advisory.
        id: `nhc:${s.id}`,
        dataSourceId: "nhc",
        externalId: s.id,
        sourceName: "NOAA National Hurricane Center",
        sourceUrl: safeUrl(adv?.url) ?? "https://www.nhc.noaa.gov/",
        title: null,
        titleIsDerived: true,
        publishedAt: new Date(adv?.issuance ?? s.lastUpdate).toISOString(),
        retrievedAt: ctx.retrievedAt,
        sourceType: "OFFICIAL_AGENCY",
        assertion: "OFFICIAL_PRELIMINARY",
        credibility: { basis: "U.S. federal forecast agency (NOAA National Weather Service)" },
      },
      rawData: { id: s.id, classification: s.classification, intensity: s.intensity, pressure: s.pressure, lastUpdate: s.lastUpdate },
    });
  }
  return { candidates, skipped };
}
