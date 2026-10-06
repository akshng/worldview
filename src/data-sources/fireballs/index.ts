/**
 * Fireballs (bright meteors / bolides) detected by U.S. government sensors, from
 * the NASA JPL Center for Near-Earth Object Studies fireball API (keyless).
 * Reports are published with a delay of days to weeks.
 */
import type { EventCandidateInput } from "@/types/events";
import { httpGet, type DataSourceConnector, type FetchContext, type ParseContext, type ParseResult } from "../types";

export interface FireballRaw {
  fields: string[];
  data: Array<Array<string | null>>;
}

const MAX_AGE_MS = 365 * 86_400_000;

export async function fetchFireballs(ctx: FetchContext): Promise<FireballRaw> {
  const since = new Date(ctx.now - MAX_AGE_MS).toISOString().slice(0, 10);
  return (await (await httpGet(`https://ssd-api.jpl.nasa.gov/fireball.api?req-loc=true&date-min=${since}`, ctx)).json()) as FireballRaw;
}

export function parseFireballs(raw: FireballRaw, ctx: ParseContext): ParseResult {
  const candidates: EventCandidateInput[] = [];
  let skipped = 0;
  const f = (row: Array<string | null>, name: string) => row[raw.fields.indexOf(name)] ?? null;
  for (const row of raw.data ?? []) {
    const date = f(row, "date");
    const lat = Number(f(row, "lat")) * (f(row, "lat-dir") === "S" ? -1 : 1);
    const lon = Number(f(row, "lon")) * (f(row, "lon-dir") === "W" ? -1 : 1);
    const at = date ? new Date(`${date.replace(" ", "T")}Z`) : null;
    if (!at || Number.isNaN(at.getTime()) || !Number.isFinite(lat) || !Number.isFinite(lon) || ctx.now - at.getTime() > MAX_AGE_MS) {
      skipped++;
      continue;
    }
    const impactKt = Number(f(row, "impact-e"));
    const alt = f(row, "alt");
    const vel = f(row, "vel");
    const kt = Number.isFinite(impactKt) ? impactKt : null;
    candidates.push({
      type: "SPACE",
      subtype: "fireball",
      title: `Fireball over ${Math.abs(lat).toFixed(1)}°${lat >= 0 ? "N" : "S"} ${Math.abs(lon).toFixed(1)}°${lon >= 0 ? "E" : "W"}${kt !== null ? ` — ~${kt < 1 ? kt.toFixed(2) : kt.toFixed(1)} kt` : ""}`,
      summary:
        `U.S. government sensors detected a fireball (bright meteor) at ${at.toISOString().slice(0, 19).replace("T", " ")} UTC` +
        `${alt ? `, peak brightness at ${alt} km altitude` : ""}${vel ? `, entering at ${vel} km/s` : ""}.` +
        `${kt !== null ? ` Estimated total impact energy about ${kt} kilotons of TNT.` : ""} Data from NASA JPL CNEOS; such objects almost always break up high in the atmosphere.`,
      latitude: lat,
      longitude: lon,
      geoPrecision: "approximate",
      locationName: null,
      timestamp: at.toISOString(),
      metrics: { impact_energy_kt: kt, radiated_energy_1e10j: Number(f(row, "energy")) || null, altitude_km: alt ? Number(alt) : null, velocity_kms: vel ? Number(vel) : null },
      entities: [{ type: "ORGANIZATION", name: "NASA JPL CNEOS", code: null }],
      source: {
        id: `fireballs:${date}`,
        dataSourceId: "fireballs",
        externalId: String(date),
        sourceName: "NASA JPL Center for Near-Earth Object Studies — Fireballs",
        sourceUrl: "https://cneos.jpl.nasa.gov/fireballs/",
        title: null,
        titleIsDerived: true,
        publishedAt: at.toISOString(),
        retrievedAt: ctx.retrievedAt,
        sourceType: "OFFICIAL_AGENCY",
        assertion: "MEASUREMENT",
        credibility: { basis: "U.S. government sensor detections published by NASA JPL" },
      },
      rawData: Object.fromEntries(raw.fields.map((k, i) => [k, row[i]])),
    });
  }
  return { candidates, skipped };
}

export const fireballsConnector: DataSourceConnector<FireballRaw> = {
  id: "fireballs",
  name: "Fireballs (bolides)",
  description: "Bright meteors detected by U.S. government sensors, with estimated impact energy, published by NASA JPL (last 12 months; reports arrive days to weeks later).",
  homepage: "https://cneos.jpl.nasa.gov/fireballs/",
  attribution: "NASA/JPL-Caltech CNEOS — public",
  sourceType: "OFFICIAL_AGENCY",
  categories: ["SPACE"],
  refreshIntervalMs: 6 * 60 * 60_000,
  mode: "live",
  fetch: fetchFireballs,
  parse: parseFireballs,
};
