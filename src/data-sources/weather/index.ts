import type { DataSourceConnector } from "../types";
import { fetchNwsAlerts } from "./client";
import { parseNwsAlerts } from "./parser";
import type { NwsAlertCollection } from "./types";

export const weatherConnector: DataSourceConnector<NwsAlertCollection> = {
  id: "nws",
  name: "NWS severe weather alerts",
  description: "Active severe and extreme weather alerts with warning polygons from the U.S. National Weather Service (United States only).",
  homepage: "https://www.weather.gov/",
  attribution: "NOAA / National Weather Service — public domain",
  sourceType: "OFFICIAL_AGENCY",
  categories: ["WEATHER", "FLOOD"],
  refreshIntervalMs: 5 * 60_000,
  mode: "live",
  fetch: fetchNwsAlerts,
  parse: parseNwsAlerts,
};
