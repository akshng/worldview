import type { DataSourceConnector } from "../types";
import { fetchDemo } from "./client";
import { generateDemoEvents } from "./parser";
import type { DemoRaw } from "./types";

export const demoConnector: DataSourceConnector<DemoRaw> = {
  id: "demo",
  name: "Demo generator (simulated)",
  description: "Clearly-labelled synthetic events for development without network access. Never mixed with live data.",
  homepage: "",
  attribution: "Synthetic — not real data",
  sourceType: "SYNTHETIC",
  categories: ["NEWS", "POLITICS", "CONFLICT", "PROTEST", "WEATHER", "EARTHQUAKE", "FIRE", "FLOOD"],
  refreshIntervalMs: 5 * 60_000,
  mode: "demo",
  fetch: fetchDemo,
  parse: generateDemoEvents,
};
