/**
 * Connector registry. To add a data source, create src/data-sources/<id>/ and
 * add its connector here. See docs/DATA_SOURCES.md.
 */
import type { DataSourceConnector } from "./types";
import { usgsConnector } from "./usgs";
import { gdeltConnector } from "./gdelt";
import { gkgConnector } from "./gdelt-gkg";
import { firmsConnector } from "./nasa-firms";
import { weatherConnector } from "./weather";
import { gdacsConnector } from "./gdacs";
import { eonetConnector } from "./eonet";
import { spaceConnector } from "./space";
import { iodaConnector } from "./ioda";
import { faaConnector } from "./faa";
import { tsunamiConnector } from "./tsunami";
import { whoConnector } from "./who";
import { secConnector } from "./sec";
import { meteoalarmConnector } from "./meteoalarm";
import { emscConnector } from "./emsc";
import { usgsVolcanoConnector } from "./usgs-volcano";
import { cemsConnector } from "./copernicus-ems";
import { ukFloodsConnector } from "./uk-floods";
import { nhcConnector } from "./nhc";
import { spcReportsConnector } from "./spc-reports";
import { nifcConnector } from "./nifc";
import { newsRssConnector } from "./news-rss";
import { federalRegisterConnector } from "./federal-register";
import { travelAdvisoriesConnector } from "./travel-advisories";
import { fcdoTravelConnector } from "./fcdo-travel";
import { canadaTravelConnector } from "./canada-travel";
import { smartravellerConnector } from "./smartraveller";
import { cdcTravelConnector } from "./cdc-travel";
import { adsbEmergencyConnector } from "./adsb-emergency";
import { wikipediaEventsConnector } from "./wikipedia-events";
import { airQualityConnector } from "./air-quality";
import { fdicFailuresConnector } from "./fdic-failures";
import { fireballsConnector } from "./fireballs";
import { ecccConnector } from "./eccc";
import { auEmergencyConnector } from "./au-emergency";
import { jmaQuakeConnector } from "./jma-quake";
import { jmaVolcanoConnector } from "./jma-volcano";
import { bmkgConnector } from "./bmkg";
import { geonetConnector } from "./geonet";
import { afadConnector } from "./afad";
import { ssnMexicoConnector } from "./ssn-mexico";
import { hkoWarningsConnector } from "./hko-warnings";
import { demoConnector } from "./demo";

export const CONNECTORS = [
  usgsConnector,
  emscConnector,
  jmaQuakeConnector,
  bmkgConnector,
  geonetConnector,
  afadConnector,
  ssnMexicoConnector,
  gdacsConnector,
  nhcConnector,
  spcReportsConnector,
  weatherConnector,
  meteoalarmConnector,
  ecccConnector,
  auEmergencyConnector,
  hkoWarningsConnector,
  ukFloodsConnector,
  eonetConnector,
  usgsVolcanoConnector,
  jmaVolcanoConnector,
  cemsConnector,
  firmsConnector,
  nifcConnector,
  gdeltConnector,
  gkgConnector,
  newsRssConnector,
  wikipediaEventsConnector,
  spaceConnector,
  fireballsConnector,
  tsunamiConnector,
  faaConnector,
  adsbEmergencyConnector,
  iodaConnector,
  whoConnector,
  cdcTravelConnector,
  airQualityConnector,
  travelAdvisoriesConnector,
  fcdoTravelConnector,
  canadaTravelConnector,
  smartravellerConnector,
  federalRegisterConnector,
  secConnector,
  fdicFailuresConnector,
  demoConnector,
] as unknown as DataSourceConnector<unknown>[];

export function getConnector(id: string): DataSourceConnector<unknown> | undefined {
  return CONNECTORS.find((c) => c.id === id);
}
