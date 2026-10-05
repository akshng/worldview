/** Copernicus Emergency Management Service — Rapid Mapping public dashboard API. */
export interface CemsActivation {
  code: string;
  countries: string[];
  eventTime: string | null;
  name: string;
  /** WKT, e.g. "POINT (24.97 35.22)" */
  centroid: string | null;
  activationTime: string;
  category: string;
  lastUpdate: string | null;
  closed: boolean;
  gdacsId: string | null;
  n_aois?: number;
  n_products?: number;
}
export interface CemsRaw {
  results: CemsActivation[];
}
