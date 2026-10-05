import type { DataSourceConnector } from "../types";
import { fetchTsunami } from "./client";
import { parseTsunami } from "./parser";
import type { TsunamiRaw } from "./types";

export const tsunamiConnector: DataSourceConnector<TsunamiRaw> = {
  id: "tsunami",
  name: "NOAA tsunami messages",
  description: "Tsunami warnings, advisories, watches and information statements from NOAA's two tsunami warning centers.",
  homepage: "https://www.tsunami.gov/",
  attribution: "NOAA / National Weather Service — public domain",
  sourceType: "OFFICIAL_AGENCY",
  categories: ["WEATHER"],
  refreshIntervalMs: 3 * 60_000,
  mode: "live",
  fetch: fetchTsunami,
  parse: parseTsunami,
};
