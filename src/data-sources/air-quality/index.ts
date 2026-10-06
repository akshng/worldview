/**
 * Air quality in the world's largest cities: current US AQI from the Copernicus
 * Atmosphere Monitoring Service (CAMS) global model, via Open-Meteo (keyless).
 * Modelled estimates, not station measurements. Only Unhealthy (AQI ≥ 151) or worse is mapped.
 */
import type { EventCandidateInput } from "@/types/events";
import { CITIES, type City } from "@/lib/geo/gazetteer";
import { httpGet, type DataSourceConnector, type FetchContext, type ParseContext, type ParseResult } from "../types";

export interface AqReading {
  time: string;
  us_aqi: number | null;
  pm2_5: number | null;
  pm10: number | null;
  ozone: number | null;
  nitrogen_dioxide: number | null;
}
export interface AirQualityRaw {
  readings: Array<{ city: City; current: AqReading }>;
}

export const MIN_AQI = 151;
const BATCH = 50;

export function aqiCategory(aqi: number): string {
  if (aqi >= 301) return "Hazardous";
  if (aqi >= 201) return "Very unhealthy";
  if (aqi >= 151) return "Unhealthy";
  if (aqi >= 101) return "Unhealthy for sensitive groups";
  if (aqi >= 51) return "Moderate";
  return "Good";
}

/** Cities of 2M+ people (≈200), from the bundled Natural Earth gazetteer. */
const majorCities = () => CITIES.filter((c) => c.country && c.population >= 2_000_000);

export async function fetchAirQuality(ctx: FetchContext): Promise<AirQualityRaw> {
  const cities = majorCities();
  const readings: AirQualityRaw["readings"] = [];
  for (let i = 0; i < cities.length; i += BATCH) {
    const batch = cities.slice(i, i + BATCH);
    const url =
      "https://air-quality-api.open-meteo.com/v1/air-quality?current=us_aqi,pm2_5,pm10,ozone,nitrogen_dioxide&domains=cams_global" +
      `&latitude=${batch.map((c) => c.lat.toFixed(3)).join(",")}&longitude=${batch.map((c) => c.lon.toFixed(3)).join(",")}`;
    const j = (await (await httpGet(url, ctx)).json()) as Array<{ current?: AqReading }> | { current?: AqReading };
    const list = Array.isArray(j) ? j : [j];
    list.forEach((r, k) => r.current && readings.push({ city: batch[k], current: r.current }));
  }
  return { readings };
}

const r1 = (v: number | null) => (typeof v === "number" ? Math.round(v * 10) / 10 : null);

export function parseAirQuality(raw: AirQualityRaw, ctx: ParseContext): ParseResult {
  const candidates: EventCandidateInput[] = [];
  let skipped = 0;
  for (const { city, current } of raw.readings ?? []) {
    const aqi = current.us_aqi;
    if (typeof aqi !== "number" || aqi < MIN_AQI || !city.country) {
      skipped++;
      continue;
    }
    // Open-Meteo times are GMT without a zone designator.
    const at = new Date(`${current.time}:00Z`);
    if (Number.isNaN(at.getTime())) {
      skipped++;
      continue;
    }
    const cat = aqiCategory(aqi);
    const day = at.toISOString().slice(0, 10);
    const key = `${city.country}:${city.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}:${day}`;
    candidates.push({
      type: "HEALTH",
      subtype: "air quality",
      title: `${cat} air quality in ${city.name} — US AQI ${Math.round(aqi)}`,
      summary:
        `The Copernicus CAMS global air-quality model estimates a US AQI of ${Math.round(aqi)} (${cat.toLowerCase()}) in ${city.name}, ${city.countryName} at ${at.toISOString().slice(0, 16).replace("T", " ")} UTC` +
        `${current.pm2_5 !== null ? `, with PM2.5 at ${r1(current.pm2_5)} µg/m³` : ""}. This is a modelled estimate, not a ground-station measurement.`,
      latitude: city.lat,
      longitude: city.lon,
      geoPrecision: "city",
      locationName: `${city.name}, ${city.countryName}`,
      country: city.country,
      timestamp: at.toISOString(),
      metrics: { us_aqi: Math.round(aqi), category: cat, pm2_5: r1(current.pm2_5), pm10: r1(current.pm10), ozone: r1(current.ozone), no2: r1(current.nitrogen_dioxide), modelled: true },
      entities: [{ type: "ORGANIZATION", name: "Copernicus Atmosphere Monitoring Service", code: "CAMS" }],
      source: {
        // One record per city per day, updated hourly.
        id: `air-quality:${key}`,
        dataSourceId: "air-quality",
        externalId: key,
        sourceName: "Copernicus CAMS air-quality model (via Open-Meteo)",
        sourceUrl: `https://open-meteo.com/en/docs/air-quality-api#latitude=${city.lat.toFixed(2)}&longitude=${city.lon.toFixed(2)}`,
        title: null,
        titleIsDerived: true,
        publishedAt: at.toISOString(),
        retrievedAt: ctx.retrievedAt,
        sourceType: "SCIENTIFIC",
        assertion: "OFFICIAL_PRELIMINARY",
        credibility: { basis: "EU Copernicus programme atmospheric model (ECMWF); modelled, not measured" },
      },
      rawData: { city: city.name, country: city.country, ...current },
    });
  }
  return { candidates, skipped };
}

export const airQualityConnector: DataSourceConnector<AirQualityRaw> = {
  id: "air-quality",
  name: "Air quality (major cities)",
  description: "Cities of 2M+ people where the Copernicus CAMS model estimates Unhealthy or worse air (US AQI ≥ 151), refreshed hourly. Modelled estimates.",
  homepage: "https://open-meteo.com/en/docs/air-quality-api",
  attribution: "Copernicus Atmosphere Monitoring Service via Open-Meteo — CC BY 4.0",
  sourceType: "SCIENTIFIC",
  categories: ["HEALTH"],
  refreshIntervalMs: 60 * 60_000,
  timeoutMs: 60_000,
  mode: "live",
  fetch: fetchAirQuality,
  parse: parseAirQuality,
};
