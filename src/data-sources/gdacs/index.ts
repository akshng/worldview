import type { DataSourceConnector } from "../types";
import { fetchGdacs } from "./client";
import { parseGdacs } from "./parser";
import type { GdacsCollection } from "./types";

export const gdacsConnector: DataSourceConnector<GdacsCollection> = {
  id: "gdacs",
  name: "GDACS disaster alerts",
  description: "Global alerts for earthquakes, tropical cyclones, floods, volcanoes, droughts and wildfires from the Global Disaster Alert and Coordination System.",
  homepage: "https://www.gdacs.org/",
  attribution: "GDACS — UN OCHA & European Commission JRC",
  sourceType: "OFFICIAL_AGENCY",
  categories: ["EARTHQUAKE", "WEATHER", "FLOOD", "VOLCANO", "DISASTER", "FIRE"],
  refreshIntervalMs: 10 * 60_000,
  mode: "live",
  fetch: fetchGdacs,
  parse: parseGdacs,
};
