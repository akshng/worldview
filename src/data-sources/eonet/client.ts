import { httpGet, type FetchContext } from "../types";
import type { EonetResponse } from "./types";

export const EONET_URL = "https://eonet.gsfc.nasa.gov/api/v3/events?status=open&days=20";

export async function fetchEonet(ctx: FetchContext): Promise<EonetResponse> {
  return (await (await httpGet(EONET_URL, ctx)).json()) as EonetResponse;
}
