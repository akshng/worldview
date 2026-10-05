/**
 * Weather provider: U.S. National Weather Service alerts (no key; a descriptive
 * User-Agent is required by the API). Severe and extreme alerts only.
 * Swap or add providers (e.g. a global weather API) behind the same connector shape.
 */
import { httpGet, type FetchContext } from "../types";
import type { NwsAlertCollection } from "./types";

export const NWS_ALERTS_URL = "https://api.weather.gov/alerts/active?status=actual&severity=Extreme,Severe";

export async function fetchNwsAlerts(ctx: FetchContext): Promise<NwsAlertCollection> {
  const res = await httpGet(NWS_ALERTS_URL, ctx, { accept: "application/geo+json" });
  return (await res.json()) as NwsAlertCollection;
}
