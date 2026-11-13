/** api.weather.gov active alerts (CAP/GeoJSON). https://www.weather.gov/documentation/services-web-api */
export interface NwsAlertProperties {
  "@id": string;
  id: string;
  event: string;
  headline: string | null;
  description: string | null;
  instruction: string | null;
  severity: "Extreme" | "Severe" | "Moderate" | "Minor" | "Unknown";
  certainty: string;
  urgency: string;
  sent: string;
  effective: string;
  onset: string | null;
  expires: string | null;
  ends: string | null;
  areaDesc: string;
  senderName: string;
  messageType: string;
  status: string;
  /** CAP parameters; VTEC e.g. "/O.EXT.KPSR.FL.W.0012.000000T0000Z-261106T0300Z/" */
  parameters?: Record<string, string[] | undefined>;
  references?: Array<{ "@id": string; identifier: string; sender: string; sent: string }>;
}

export interface NwsAlertFeature {
  id: string;
  type: "Feature";
  geometry: { type: "Polygon"; coordinates: number[][][] } | { type: "MultiPolygon"; coordinates: number[][][][] } | null;
  properties: NwsAlertProperties;
}

export interface NwsAlertCollection {
  type: "FeatureCollection";
  features: NwsAlertFeature[];
}
