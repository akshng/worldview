import type { DataSourceConnector } from "../types";
import { fetchFirms } from "./client";
import { parseFirms } from "./parser";
import type { FirmsRaw } from "./types";

export const firmsConnector: DataSourceConnector<FirmsRaw> = {
  id: "nasa-firms",
  name: "NASA FIRMS fires",
  description:
    "Satellite thermal-anomaly detections (VIIRS S-NPP, last 24 h), clustered into fire-activity areas. Uses the FIRMS API when NASA_FIRMS_MAP_KEY is set, otherwise the public 24 h file.",
  homepage: "https://firms.modaps.eosdis.nasa.gov/",
  attribution: "NASA FIRMS — LANCE near real-time data",
  sourceType: "SATELLITE",
  categories: ["FIRE"],
  refreshIntervalMs: 30 * 60_000,
  timeoutMs: 120_000,
  mode: "live",
  fetch: fetchFirms,
  parse: parseFirms,
};
