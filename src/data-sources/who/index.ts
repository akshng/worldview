import type { DataSourceConnector } from "../types";
import { fetchWho } from "./client";
import { parseWho } from "./parser";
import type { WhoDonResponse } from "./types";

export const whoConnector: DataSourceConnector<WhoDonResponse> = {
  id: "who",
  name: "WHO disease outbreaks",
  description: "Disease Outbreak News reports from the World Health Organization (last 45 days), placed at the affected country.",
  homepage: "https://www.who.int/emergencies/disease-outbreak-news",
  attribution: "World Health Organization",
  sourceType: "OFFICIAL_AGENCY",
  categories: ["HEALTH"],
  refreshIntervalMs: 60 * 60_000,
  mode: "live",
  mergeWithinSource: true,
  fetch: fetchWho,
  parse: parseWho,
};
