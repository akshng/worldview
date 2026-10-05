import { httpGet, type FetchContext } from "../types";
import type { ElevatedVolcano, UsgsVolcanoRaw, VolcanoInfo } from "./types";

const BASE = "https://volcanoes.usgs.gov/hans-public/api/volcano";
// Volcano locations never change; cache them for the life of the process.
const infoCache = new Map<string, VolcanoInfo>();

export async function fetchUsgsVolcano(ctx: FetchContext): Promise<UsgsVolcanoRaw> {
  const elevated = (await (await httpGet(`${BASE}/getElevatedVolcanoes`, ctx)).json()) as ElevatedVolcano[];
  const info: Record<string, VolcanoInfo> = {};
  for (const v of elevated) {
    let i = infoCache.get(v.vnum);
    if (!i) {
      try {
        i = (await (await httpGet(`${BASE}/getVolcano/${encodeURIComponent(v.vnum)}`, ctx)).json()) as VolcanoInfo;
        infoCache.set(v.vnum, i);
      } catch {
        continue; // parser skips volcanoes without a location
      }
    }
    info[v.vnum] = i;
  }
  return { elevated, info };
}
