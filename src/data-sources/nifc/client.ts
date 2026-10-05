import { httpGet, type FetchContext } from "../types";
import type { NifcRaw } from "./types";

const FIELDS = "IncidentName,IncidentSize,PercentContained,FireDiscoveryDateTime,ModifiedOnDateTime_dt,FireOutDateTime,POOState,POOCounty,POOCity,TotalIncidentPersonnel,FireCause,UniqueFireIdentifier,IrwinID";

/** Wildfires (not prescribed burns) of 100+ acres that are not declared out. */
export async function fetchNifc(ctx: FetchContext): Promise<NifcRaw> {
  const where = encodeURIComponent("IncidentTypeCategory='WF' AND IncidentSize>=100 AND FireOutDateTime IS NULL");
  const url = `https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Incident_Locations_Current/FeatureServer/0/query?where=${where}&outFields=${FIELDS}&f=geojson&resultRecordCount=1000`;
  return (await (await httpGet(url, ctx, { accept: "application/geo+json, application/json" })).json()) as NifcRaw;
}
