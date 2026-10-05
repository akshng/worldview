import type { DataSourceConnector } from "../types";
import { fetchSpc } from "./client";
import { parseSpc } from "./parser";
import type { SpcRaw } from "./types";

export const spcReportsConnector: DataSourceConnector<SpcRaw> = {
  id: "spc-reports",
  name: "US tornado, hail & wind reports",
  description: "Preliminary local storm reports (tornadoes, damaging winds, large hail) from the NOAA Storm Prediction Center, last 3 report days.",
  homepage: "https://www.spc.noaa.gov/climo/reports/",
  attribution: "NOAA Storm Prediction Center — public domain",
  sourceType: "OFFICIAL_AGENCY",
  categories: ["WEATHER"],
  refreshIntervalMs: 10 * 60_000,
  mode: "live",
  fetch: fetchSpc,
  parse: parseSpc,
};
