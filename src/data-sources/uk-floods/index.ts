import type { DataSourceConnector } from "../types";
import { fetchUkFloods } from "./client";
import { parseUkFloods } from "./parser";
import type { UkFloodsRaw } from "./types";

export const ukFloodsConnector: DataSourceConnector<UkFloodsRaw> = {
  id: "uk-floods",
  name: "UK flood warnings (England)",
  description: "Live flood alerts, flood warnings and severe flood warnings from the Environment Agency's real-time flood-monitoring service.",
  homepage: "https://environment.data.gov.uk/flood-monitoring/doc/reference",
  attribution: "Environment Agency — Open Government Licence v3.0",
  sourceType: "OFFICIAL_AGENCY",
  categories: ["FLOOD"],
  refreshIntervalMs: 15 * 60_000,
  timeoutMs: 90_000,
  mode: "live",
  fetch: fetchUkFloods,
  parse: parseUkFloods,
};
