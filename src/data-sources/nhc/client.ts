import { httpGet, type FetchContext } from "../types";
import type { NhcRaw } from "./types";

export async function fetchNhc(ctx: FetchContext): Promise<NhcRaw> {
  return (await (await httpGet("https://www.nhc.noaa.gov/CurrentStorms.json", ctx)).json()) as NhcRaw;
}
