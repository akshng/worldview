import { httpGet, type FetchContext } from "../types";
import type { UkFloodArea, UkFloodWarning, UkFloodsRaw } from "./types";

const BASE = "https://environment.data.gov.uk/flood-monitoring/id";
const MAX_AREA_LOOKUPS = 150;
// Flood area locations are static; cache them for the life of the process.
const areaCache = new Map<string, UkFloodArea>();

export async function fetchUkFloods(ctx: FetchContext): Promise<UkFloodsRaw> {
  const { items } = (await (await httpGet(`${BASE}/floods?min-severity=3`, ctx)).json()) as { items: UkFloodWarning[] };
  const areas: Record<string, UkFloodArea> = {};
  let lookups = 0;
  // Most severe first so they get looked up if we hit the cap.
  for (const w of [...items].sort((a, b) => a.severityLevel - b.severityLevel)) {
    let a = areaCache.get(w.floodAreaID);
    if (!a && lookups < MAX_AREA_LOOKUPS) {
      lookups++;
      try {
        const d = (await (await httpGet(`${BASE}/floodAreas/${encodeURIComponent(w.floodAreaID)}`, ctx)).json()) as { items: UkFloodArea };
        a = { lat: d.items.lat, long: d.items.long, label: d.items.label, county: d.items.county };
        areaCache.set(w.floodAreaID, a);
      } catch {
        /* skipped by the parser */
      }
    }
    if (a) areas[w.floodAreaID] = a;
  }
  return { items, areas };
}
