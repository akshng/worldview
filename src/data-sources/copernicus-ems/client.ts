import { httpGet, type FetchContext } from "../types";
import type { CemsRaw } from "./types";

/** Newest 60 activations (≈ the last few months). */
export async function fetchCems(ctx: FetchContext): Promise<CemsRaw> {
  const res = await httpGet("https://rapidmapping.emergency.copernicus.eu/backend/dashboard-api/public-activations-info/?limit=60", ctx);
  return (await res.json()) as CemsRaw;
}
