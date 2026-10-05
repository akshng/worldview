/** USGS GeoJSON summary feed — https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php */
export interface UsgsFeatureProperties {
  mag: number | null;
  place: string | null;
  time: number;
  updated: number;
  url: string;
  detail: string;
  felt: number | null;
  cdi: number | null;
  mmi: number | null;
  alert: "green" | "yellow" | "orange" | "red" | null;
  status: "automatic" | "reviewed" | "deleted";
  tsunami: 0 | 1;
  sig: number;
  net: string;
  code: string;
  sources: string;
  magType: string | null;
  type: string;
  title: string;
}

export interface UsgsFeature {
  type: "Feature";
  id: string;
  properties: UsgsFeatureProperties;
  geometry: { type: "Point"; coordinates: [number, number, number] };
}

export interface UsgsFeed {
  type: "FeatureCollection";
  metadata: { generated: number; url: string; title: string; count: number };
  features: UsgsFeature[];
}
