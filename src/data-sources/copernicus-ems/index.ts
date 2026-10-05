import type { DataSourceConnector } from "../types";
import { fetchCems } from "./client";
import { parseCems } from "./parser";
import type { CemsRaw } from "./types";

export const cemsConnector: DataSourceConnector<CemsRaw> = {
  id: "copernicus-ems",
  name: "Copernicus Emergency Mapping",
  description: "Disasters worldwide (floods, wildfires, storms, earthquakes, industrial accidents) for which the EU's Copernicus service activated satellite rapid mapping.",
  homepage: "https://rapidmapping.emergency.copernicus.eu/",
  attribution: "© European Union, Copernicus Emergency Management Service",
  sourceType: "OFFICIAL_AGENCY",
  categories: ["FLOOD", "FIRE", "WEATHER", "EARTHQUAKE", "VOLCANO", "DISASTER", "INFRASTRUCTURE"],
  refreshIntervalMs: 60 * 60_000,
  mode: "live",
  fetch: fetchCems,
  parse: parseCems,
};
