import type { DataSourceConnector } from "../types";
import { fetchGdelt } from "./client";
import { parseGdelt } from "./parser";
import type { GdeltRaw } from "./types";

export const gdeltConnector: DataSourceConnector<GdeltRaw> = {
  id: "gdelt",
  name: "GDELT news events",
  description: "Machine-coded conflict, protest and political events from worldwide news coverage (GDELT 2.0 event export, 15-minute updates).",
  homepage: "https://www.gdeltproject.org/",
  attribution: "The GDELT Project — open data; source articles belong to their publishers",
  sourceType: "NEWS_AGGREGATOR",
  categories: ["CONFLICT", "PROTEST", "POLITICS", "TECHNOLOGY"],
  refreshIntervalMs: 15 * 60_000,
  timeoutMs: 90_000,
  mode: "live",
  mergeWithinSource: true,
  fetch: fetchGdelt,
  parse: parseGdelt,
};
