import type { DataSourceConnector } from "../types";
import { fetchNewsRss } from "./client";
import { parseNewsRss } from "./parser";
import type { NewsRssRaw } from "./types";

export const newsRssConnector: DataSourceConnector<NewsRssRaw> = {
  id: "news-rss",
  name: "World news (global & regional outlets)",
  description:
    "Headlines from 42 outlets' public feeds — global desks (BBC, Al Jazeera, DW, France 24, UN News, Guardian …) plus regional ones across Asia (SCMP, Japan Times, The Hindu, Dawn, Straits Times, Yonhap …), the Middle East (Arab News, Haaretz, The National …), Africa (Africanews, AllAfrica, Premium Times, Daily Maverick …), Latin America (MercoPress, Buenos Aires Times, Mexico News Daily …) and Europe (Kyiv Independent, Meduza, Balkan Insight, RFE/RL …) — placed by the place each headline names. The same story from several outlets is merged.",
  homepage: "https://www.bbc.com/news/world",
  attribution: "Headlines, short summaries and links from each outlet's public RSS feed; articles remain on the publishers' sites",
  sourceType: "NEWS_MEDIA",
  categories: ["NEWS", "POLITICS", "CONFLICT", "PROTEST", "BUSINESS", "MARKETS", "TECHNOLOGY", "SCIENCE", "HEALTH", "DISASTER"],
  refreshIntervalMs: 15 * 60_000,
  timeoutMs: 90_000, // 42 feeds, 8 at a time, ≤ 12 s each
  mode: "live",
  mergeWithinSource: true,
  fetch: fetchNewsRss,
  parse: parseNewsRss,
};
