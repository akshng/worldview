import { httpGet, type FetchContext } from "../types";
import type { IodaResponse } from "./types";

export async function fetchIoda(ctx: FetchContext): Promise<IodaResponse> {
  const until = Math.floor(ctx.now / 1000), from = until - 3 * 86_400;
  const url = `https://api.ioda.inetintel.cc.gatech.edu/v2/outages/events?from=${from}&until=${until}&entityType=country&limit=500`;
  const res = (await (await httpGet(url, ctx)).json()) as IodaResponse;
  if (res.error) throw new Error(`IODA: ${res.error}`);
  return res;
}
