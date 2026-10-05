import { httpGet, type FetchContext } from "../types";
import type { UsgsFeed } from "./types";

/** M2.5+ past week. The summary feeds are regenerated every minute by USGS. */
export const USGS_FEED_URL = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_week.geojson";

export async function fetchUsgsFeed(ctx: FetchContext): Promise<UsgsFeed> {
  const res = await httpGet(USGS_FEED_URL, ctx, { accept: "application/geo+json, application/json" });
  return (await res.json()) as UsgsFeed;
}
