import { httpGet, type FetchContext } from "../types";
import type { GdacsCollection } from "./types";

/** Current/recent events across all hazard types (the endpoint used by the GDACS app). */
export const GDACS_URL = "https://www.gdacs.org/gdacsapi/api/events/geteventlist/EVENTS4APP";

export async function fetchGdacs(ctx: FetchContext): Promise<GdacsCollection> {
  return (await (await httpGet(GDACS_URL, ctx)).json()) as GdacsCollection;
}
