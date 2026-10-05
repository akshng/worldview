import type { DataSourceConnector } from "../types";
import { fetchNewsRss } from "./client";
import { parseNewsRss } from "./parser";
import type { NewsRssRaw } from "./types";

export const newsRssConnector: DataSourceConnector<NewsRssRaw> = {
  id: "news-rss",
  name: "World news (major outlets)",
  description: "Headlines from the world desks of BBC, Al Jazeera, NPR, Deutsche Welle, France 24, UN News, The Guardian, CNBC, Sky News and ABC Australia, placed by the place each headline names. The same story from several outlets is merged.",
  homepage: "https://www.bbc.com/news/world",
  attribution: "Headlines, short summaries and links from each outlet's public RSS feed; articles remain on the publishers' sites",
  sourceType: "NEWS_MEDIA",
  categories: ["NEWS", "POLITICS", "CONFLICT", "PROTEST", "BUSINESS", "MARKETS", "TECHNOLOGY", "SCIENCE", "HEALTH", "DISASTER"],
  refreshIntervalMs: 15 * 60_000,
  timeoutMs: 60_000,
  mode: "live",
  mergeWithinSource: true,
  fetch: fetchNewsRss,
  parse: parseNewsRss,
};
