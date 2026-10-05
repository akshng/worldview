import { httpGet, type FetchContext } from "../types";
import type { FaaRaw } from "./types";

export async function fetchFaa(ctx: FetchContext): Promise<FaaRaw> {
  return { xml: await (await httpGet("https://nasstatus.faa.gov/api/airport-status-information", ctx, { accept: "application/xml" })).text() };
}
