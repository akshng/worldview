import type { DataSourceConnector } from "../types";
import { fetchUsgsVolcano } from "./client";
import { parseUsgsVolcano } from "./parser";
import type { UsgsVolcanoRaw } from "./types";

export const usgsVolcanoConnector: DataSourceConnector<UsgsVolcanoRaw> = {
  id: "usgs-volcano",
  name: "USGS Volcano Alerts",
  description: "US volcanoes (Alaska, Hawaii, Cascades, Marianas…) currently above normal alert level, from the USGS volcano observatories.",
  homepage: "https://www.usgs.gov/programs/VHP",
  attribution: "U.S. Geological Survey — public domain",
  sourceType: "OFFICIAL_AGENCY",
  categories: ["VOLCANO"],
  refreshIntervalMs: 30 * 60_000,
  mode: "live",
  fetch: fetchUsgsVolcano,
  parse: parseUsgsVolcano,
};
