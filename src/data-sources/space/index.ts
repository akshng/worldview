import type { DataSourceConnector } from "../types";
import { fetchLaunches } from "./client";
import { parseLaunches } from "./parser";
import type { SpaceRaw } from "./types";

export const spaceConnector: DataSourceConnector<SpaceRaw> = {
  id: "space",
  name: "Rocket launches",
  description: "Orbital launches from the past 7 days and scheduled launches for the next 7 days, from Launch Library 2.",
  homepage: "https://thespacedevs.com/llapi",
  attribution: "Launch Library 2 by The Space Devs",
  sourceType: "COMMUNITY_DATABASE",
  categories: ["SPACE"],
  refreshIntervalMs: 30 * 60_000,
  mode: "live",
  fetch: fetchLaunches,
  parse: parseLaunches,
};
