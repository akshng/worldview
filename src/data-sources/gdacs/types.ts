/** GDACS event list (GeoJSON). https://www.gdacs.org/ — Global Disaster Alert and Coordination System */
export interface GdacsProperties {
  eventtype: "EQ" | "TC" | "FL" | "VO" | "DR" | "WF" | string;
  eventid: number;
  episodeid: number;
  eventname: string;
  name: string;
  description: string;
  htmldescription: string;
  url: { geometry?: string; report?: string; details?: string };
  alertlevel: "Green" | "Orange" | "Red" | string;
  alertscore: number;
  iscurrent: string;
  country: string;
  fromdate: string;
  todate: string;
  datemodified: string;
  iso3: string;
  source: string;
  severitydata?: { severity: number; severitytext: string; severityunit: string };
  affectedcountries?: Array<{ iso2: string; iso3: string; countryname: string }>;
}

export interface GdacsFeature {
  type: "Feature";
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: GdacsProperties;
}

export interface GdacsCollection {
  type: "FeatureCollection";
  features: GdacsFeature[];
}
