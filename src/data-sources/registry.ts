/**
 * Connector registry. To add a data source, create src/data-sources/<id>/ and
 * add its connector here. See docs/DATA_SOURCES.md.
 */
import type { DataSourceConnector } from "./types";
import { usgsConnector } from "./usgs";
import { gdeltConnector } from "./gdelt";
import { firmsConnector } from "./nasa-firms";
import { weatherConnector } from "./weather";
import { gdacsConnector } from "./gdacs";
import { eonetConnector } from "./eonet";
import { spaceConnector } from "./space";
import { demoConnector } from "./demo";

export const CONNECTORS = [
  usgsConnector,
  gdacsConnector,
  weatherConnector,
  eonetConnector,
  firmsConnector,
  gdeltConnector,
  spaceConnector,
  demoConnector,
] as unknown as DataSourceConnector<unknown>[];

export function getConnector(id: string): DataSourceConnector<unknown> | undefined {
  return CONNECTORS.find((c) => c.id === id);
}
