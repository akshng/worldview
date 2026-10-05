/** EMSC FDSN event web service (format=json) — GeoJSON FeatureCollection. */
export interface EmscFeature {
  id: string;
  geometry: { type: "Point"; coordinates: [number, number, number] } | null;
  properties: {
    unid: string;
    time: string;
    lastupdate?: string;
    flynn_region?: string;
    lat: number;
    lon: number;
    depth: number;
    evtype?: string;
    auth?: string;
    mag: number | null;
    magtype?: string;
  };
}
export interface EmscFeed {
  features: EmscFeature[];
}
