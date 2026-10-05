import { httpGet, type FetchContext } from "../types";
import type { EmscFeed } from "./types";

/** M3+ in the past 3 days. Complements USGS, whose catalogue outside the US is complete only from about M4.5. */
export async function fetchEmsc(ctx: FetchContext): Promise<EmscFeed> {
  const start = new Date(ctx.now - 3 * 86_400_000).toISOString().slice(0, 19);
  const url = `https://www.seismicportal.eu/fdsnws/event/1/query?format=json&minmag=3&limit=1000&orderby=time&start=${start}`;
  const res = await httpGet(url, ctx);
  if (res.status === 204) return { features: [] };
  return (await res.json()) as EmscFeed;
}
