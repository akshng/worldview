import type { DataSourceConnector } from "../types";
import { fetchSec } from "./client";
import { parseSec } from "./parser";
import type { SecRaw } from "./types";

export const secConnector: DataSourceConnector<SecRaw> = {
  id: "sec",
  name: "SEC 8-K material filings",
  description: "Material corporate events (bankruptcy, cyber incidents, restatements, M&A, earnings, leadership changes) from SEC EDGAR 8-K filings, at company headquarters.",
  homepage: "https://www.sec.gov/edgar/search/",
  attribution: "U.S. Securities and Exchange Commission — public domain",
  sourceType: "OFFICIAL_AGENCY",
  categories: ["BUSINESS"],
  refreshIntervalMs: 10 * 60_000,
  timeoutMs: 90_000,
  mode: "live",
  fetch: fetchSec,
  parse: parseSec,
};
