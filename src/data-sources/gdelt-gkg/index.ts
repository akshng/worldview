import type { DataSourceConnector } from "../types";
import { fetchGkg } from "./client";
import { parseGkgArticles } from "./parser";
import type { GkgRaw } from "./types";

export const gkgConnector: DataSourceConnector<GkgRaw> = {
  id: "gdelt-gkg",
  name: "GDELT news headlines",
  description:
    "Worldwide news articles with their real headlines and topic themes (GDELT Global Knowledge Graph), located where headline and geocoded mentions agree. Conflict, politics, protests, markets, business, technology, science, health, transport.",
  homepage: "https://www.gdeltproject.org/",
  attribution: "The GDELT Project — open data; articles belong to their publishers",
  sourceType: "NEWS_AGGREGATOR",
  categories: ["CONFLICT", "POLITICS", "PROTEST", "MARKETS", "BUSINESS", "TECHNOLOGY", "SCIENCE", "HEALTH", "AVIATION", "MARITIME", "INFRASTRUCTURE"],
  refreshIntervalMs: 15 * 60_000,
  timeoutMs: 120_000,
  mode: "live",
  mergeWithinSource: true,
  fetch: fetchGkg,
  parse: parseGkgArticles,
};
