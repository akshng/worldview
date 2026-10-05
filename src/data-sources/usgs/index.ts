import type { DataSourceConnector } from "../types";
import { fetchUsgsFeed } from "./client";
import { parseUsgsFeed } from "./parser";
import type { UsgsFeed } from "./types";

export const usgsConnector: DataSourceConnector<UsgsFeed> = {
  id: "usgs",
  name: "USGS Earthquakes",
  description: "Magnitude 2.5+ earthquakes worldwide from the U.S. Geological Survey real-time feed (past 7 days).",
  homepage: "https://earthquake.usgs.gov/earthquakes/feed/",
  attribution: "U.S. Geological Survey — public domain",
  sourceType: "OFFICIAL_AGENCY",
  categories: ["EARTHQUAKE"],
  refreshIntervalMs: 2 * 60_000,
  mode: "live",
  fetch: fetchUsgsFeed,
  parse: parseUsgsFeed,
};
