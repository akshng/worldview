import type { DataSourceConnector } from "../types";
import { fetchEonet } from "./client";
import { parseEonet } from "./parser";
import type { EonetResponse } from "./types";

export const eonetConnector: DataSourceConnector<EonetResponse> = {
  id: "eonet",
  name: "NASA EONET natural events",
  description: "Open natural events curated by NASA's Earth Observatory Natural Event Tracker: storms, wildfires, volcanoes, ice and more.",
  homepage: "https://eonet.gsfc.nasa.gov/",
  attribution: "NASA EONET — public domain; upstream sources as listed",
  sourceType: "SCIENTIFIC",
  categories: ["FIRE", "WEATHER", "VOLCANO", "FLOOD", "DISASTER", "OTHER"],
  refreshIntervalMs: 20 * 60_000,
  mode: "live",
  fetch: fetchEonet,
  parse: parseEonet,
};
