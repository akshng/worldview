import type { DataSourceConnector } from "../types";
import { fetchEmsc } from "./client";
import { parseEmsc } from "./parser";
import type { EmscFeed } from "./types";

export const emscConnector: DataSourceConnector<EmscFeed> = {
  id: "emsc",
  name: "EMSC Earthquakes",
  description: "Magnitude 3+ earthquakes worldwide from the European-Mediterranean Seismological Centre (past 3 days). Fills gaps in USGS coverage of smaller quakes outside the US; the same quake from both is merged.",
  homepage: "https://www.emsc-csem.org/",
  attribution: "EMSC-CSEM — free use with attribution",
  sourceType: "SCIENTIFIC",
  categories: ["EARTHQUAKE"],
  refreshIntervalMs: 5 * 60_000,
  mode: "live",
  fetch: fetchEmsc,
  parse: parseEmsc,
};
