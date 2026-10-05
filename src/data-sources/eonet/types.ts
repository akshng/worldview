/** NASA EONET v3. https://eonet.gsfc.nasa.gov/docs/v3 */
export interface EonetGeometry {
  date: string;
  type: "Point" | "Polygon";
  coordinates: number[] | number[][][];
  magnitudeValue: number | null;
  magnitudeUnit: string | null;
}

export interface EonetEvent {
  id: string;
  title: string;
  description: string | null;
  link: string;
  closed: string | null;
  categories: Array<{ id: string; title: string }>;
  sources: Array<{ id: string; url: string }>;
  geometry: EonetGeometry[];
}

export interface EonetResponse {
  events: EonetEvent[];
}
