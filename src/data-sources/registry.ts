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
import { demoConnector } from "./demo";

export const CONNECTORS = [
  usgsConnector,
  emscConnector,
  gdacsConnector,
  nhcConnector,
  spcReportsConnector,
  weatherConnector,
  meteoalarmConnector,
  ukFloodsConnector,
  eonetConnector,
  usgsVolcanoConnector,
  cemsConnector,
  firmsConnector,
  nifcConnector,
  gdeltConnector,
  gkgConnector,
  newsRssConnector,
  spaceConnector,
  tsunamiConnector,
  faaConnector,
  iodaConnector,
  whoConnector,
  secConnector,
  demoConnector,
] as unknown as DataSourceConnector<unknown>[];

export function getConnector(id: string): DataSourceConnector<unknown> | undefined {
  return CONNECTORS.find((c) => c.id === id);
}
