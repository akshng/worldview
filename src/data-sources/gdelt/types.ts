/**
 * GDELT 2.0 Event export (tab-separated, 61 columns, published every 15 minutes).
 * Codebook: http://data.gdeltproject.org/documentation/GDELT-Event_Codebook-V2.0.pdf
 */
export interface GdeltEventRow {
  globalEventId: string;
  sqlDate: string; // YYYYMMDD (event date as coded)
  actor1Name: string;
  actor1Code: string;
  actor2Name: string;
  actor2Code: string;
  /** Primary CAMEO actor type codes (e.g. MIL, REB, COP, CRM) */
  actor1Type: string;
  actor2Type: string;
  isRootEvent: boolean;
  eventCode: string;
  eventBaseCode: string;
  eventRootCode: string;
  quadClass: number;
  goldstein: number;
  numMentions: number;
  numSources: number;
  numArticles: number;
  avgTone: number;
  geoType: number; // 1 country, 2 US state, 3 US city, 4 world city, 5 world ADM1
  geoName: string;
  geoFips: string; // FIPS 10-4 country code (NOT ISO)
  lat: number;
  lon: number;
  geoFeatureId: string;
  dateAdded: string; // YYYYMMDDHHMMSS (UTC)
  sourceUrl: string;
}

export interface GdeltRaw {
  files: Array<{ url: string; rows: GdeltEventRow[] }>;
}
