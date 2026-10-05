import type { DataSourceConnector } from "../types";
import { fetchMeteoAlarm } from "./client";
import { parseMeteoAlarm } from "./parser";
import type { MeteoAlarmRaw } from "./types";

export const meteoalarmConnector: DataSourceConnector<MeteoAlarmRaw> = {
  id: "meteoalarm",
  name: "MeteoAlarm (Europe) warnings",
  description: "Orange and red weather warnings from 38 European national weather services via EUMETNET MeteoAlarm.",
  homepage: "https://meteoalarm.org/",
  attribution: "EUMETNET MeteoAlarm and national meteorological services",
  sourceType: "OFFICIAL_AGENCY",
  categories: ["WEATHER", "FLOOD"],
  refreshIntervalMs: 20 * 60_000,
  timeoutMs: 120_000,
  mode: "live",
  fetch: fetchMeteoAlarm,
  parse: parseMeteoAlarm,
};
