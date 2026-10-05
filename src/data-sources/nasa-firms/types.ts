/** NASA FIRMS active fire CSV (VIIRS S-NPP NRT). https://firms.modaps.eosdis.nasa.gov/ */
export interface FirmsDetection {
  lat: number;
  lon: number;
  frp: number; // fire radiative power, MW
  confidence: "low" | "nominal" | "high";
  acquiredAt: number; // ms epoch (UTC)
  satellite: string;
  daynight: "D" | "N";
}

export interface FirmsRaw {
  product: string;
  via: "api" | "public-file";
  detections: FirmsDetection[];
}
