import type { DataSourceConnector } from "../types";
import { fetchIoda } from "./client";
import { parseIoda } from "./parser";
import type { IodaResponse } from "./types";

export const iodaConnector: DataSourceConnector<IodaResponse> = {
  id: "ioda",
  name: "IODA internet outages",
  description: "Country-level internet connectivity disruptions detected by Georgia Tech's IODA project (BGP, active probing, traffic signals).",
  homepage: "https://ioda.inetintel.cc.gatech.edu/",
  attribution: "IODA, Georgia Institute of Technology",
  sourceType: "SCIENTIFIC",
  categories: ["INFRASTRUCTURE"],
  refreshIntervalMs: 15 * 60_000,
  mode: "live",
  fetch: fetchIoda,
  parse: parseIoda,
};
