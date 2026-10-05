/** NIFC WFIGS current wildfire incident locations (ArcGIS FeatureServer, GeoJSON). */
export interface NifcProps {
  IncidentName: string | null;
  IncidentSize: number | null;
  PercentContained: number | null;
  FireDiscoveryDateTime: number | null;
  ModifiedOnDateTime_dt: number | null;
  FireOutDateTime: number | null;
  POOState: string | null;
  POOCounty: string | null;
  POOCity: string | null;
  TotalIncidentPersonnel: number | null;
  FireCause: string | null;
  UniqueFireIdentifier: string | null;
  IrwinID: string | null;
}
export interface NifcRaw {
  features: Array<{ geometry: { type: "Point"; coordinates: [number, number] } | null; properties: NifcProps }>;
}
