import type { DataSourceConnector } from "../types";
import { fetchFaa } from "./client";
import { parseFaa } from "./parser";
import type { FaaRaw } from "./types";

export const faaConnector: DataSourceConnector<FaaRaw> = {
  id: "faa",
  name: "FAA airport status",
  description: "Ground delay programs, ground stops, delays and closures at U.S. airports from the FAA National Airspace System status.",
  homepage: "https://nasstatus.faa.gov/",
  attribution: "U.S. Federal Aviation Administration — public domain",
  sourceType: "OFFICIAL_AGENCY",
  categories: ["AVIATION"],
  refreshIntervalMs: 5 * 60_000,
  mode: "live",
  fetch: fetchFaa,
  parse: parseFaa,
};
