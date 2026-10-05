import type { DataSourceConnector } from "../types";
import { fetchNhc } from "./client";
import { parseNhc } from "./parser";
import type { NhcRaw } from "./types";

export const nhcConnector: DataSourceConnector<NhcRaw> = {
  id: "nhc",
  name: "NHC Hurricanes",
  description: "Active hurricanes, tropical storms and depressions in the Atlantic and Eastern/Central Pacific from the U.S. National Hurricane Center, updated with each advisory.",
  homepage: "https://www.nhc.noaa.gov/",
  attribution: "NOAA National Hurricane Center — public domain",
  sourceType: "OFFICIAL_AGENCY",
  categories: ["WEATHER"],
  refreshIntervalMs: 15 * 60_000,
  mode: "live",
  fetch: fetchNhc,
  parse: parseNhc,
};
