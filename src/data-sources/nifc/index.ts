import type { DataSourceConnector } from "../types";
import { fetchNifc } from "./client";
import { parseNifc } from "./parser";
import type { NifcRaw } from "./types";

export const nifcConnector: DataSourceConnector<NifcRaw> = {
  id: "nifc",
  name: "US wildfire incidents",
  description: "Named US wildfires of 100+ acres with size, containment and personnel, from the National Interagency Fire Center.",
  homepage: "https://data-nifc.opendata.arcgis.com/",
  attribution: "National Interagency Fire Center — public domain",
  sourceType: "OFFICIAL_AGENCY",
  categories: ["FIRE"],
  refreshIntervalMs: 30 * 60_000,
  mode: "live",
  fetch: fetchNifc,
  parse: parseNifc,
};
