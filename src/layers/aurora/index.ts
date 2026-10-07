/**
 * Aurora forecast from NOAA SWPC's OVATION Prime model (keyless, public domain).
 * The JSON is a 1°×1° global grid of [longitude 0–359, latitude −90–90,
 * probability %] for the probability of visible aurora — a short-term model
 * FORECAST (~30–90 minutes ahead), not an observation.
 */
import { httpGet } from "@/data-sources/types";
import type { LiveLayerProvider } from "../types";

export const OVATION_URL = "https://services.swpc.noaa.gov/json/ovation_aurora_latest.json";
/** Cells below this probability (%) are not drawn */
export const AURORA_MIN_PROB = 10;

/** [lon −180–180, lat, probability %] */
export type AuroraCell = [number, number, number];

export interface AuroraData {
  observationTime: string | null;
  forecastTime: string | null;
  minProbability: number;
  cells: AuroraCell[];
  maxProbability: number;
}

const iso = (v: unknown) => {
  if (typeof v !== "string") return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};

/** Parse the OVATION JSON, keeping cells at or above `minProb`. Throws on an unrecognised shape. */
export function parseOvation(raw: unknown, minProb = AURORA_MIN_PROB): AuroraData {
  const r = raw as { coordinates?: unknown; "Observation Time"?: unknown; "Forecast Time"?: unknown } | null;
  if (!r || !Array.isArray(r.coordinates)) throw new Error("OVATION: missing coordinates grid");
  const cells: AuroraCell[] = [];
  let max = 0;
  for (const c of r.coordinates as unknown[]) {
    if (!Array.isArray(c) || c.length < 3) continue;
    const [lon, lat, p] = c as [unknown, unknown, unknown];
    if (typeof lon !== "number" || typeof lat !== "number" || typeof p !== "number") continue;
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || !Number.isFinite(p) || Math.abs(lat) > 90) continue;
    if (p > max) max = p;
    if (p < minProb) continue;
    cells.push([lon > 180 ? lon - 360 : lon, lat, p]);
  }
  return { observationTime: iso(r["Observation Time"]), forecastTime: iso(r["Forecast Time"]), minProbability: minProb, cells, maxProbability: max };
}

export function auroraFeatures(data: AuroraData): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: data.cells.map(([lon, lat, p]) => ({ type: "Feature", geometry: { type: "Point", coordinates: [lon, lat] }, properties: { p } })),
  };
}

export const auroraLayer: LiveLayerProvider<AuroraData> = {
  id: "aurora",
  name: "Aurora forecast (NOAA SWPC OVATION)",
  description: "Modelled probability of visible aurora on a 1° grid, ~30–90 minutes ahead. Forecast, not observation.",
  homepage: "https://www.swpc.noaa.gov/products/aurora-30-minute-forecast",
  attribution: "Aurora forecast: NOAA SWPC OVATION Prime",
  ttlMs: 10 * 60_000,
  async load(ctx) {
    const data = parseOvation(await (await httpGet(OVATION_URL, ctx)).json());
    return {
      layerId: "aurora",
      observedAt: data.observationTime ?? new Date(ctx.now).toISOString(),
      retrievedAt: new Date(ctx.now).toISOString(),
      count: data.cells.length,
      data,
      attribution: this.attribution,
      notes: [`Forecast (model output) valid ${data.forecastTime ?? "time not given"}; cells below ${AURORA_MIN_PROB}% are hidden.`],
    };
  },
};
