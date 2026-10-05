import { httpGet, type FetchContext } from "../types";
import type { Ll2Page, SpaceRaw } from "./types";

const BASE = "https://ll.thespacedevs.com/2.3.0/launches";

/** Two requests per run; with a 30-minute interval this stays well under the 15 req/h free tier. */
export async function fetchLaunches(ctx: FetchContext): Promise<SpaceRaw> {
  const [up, prev] = await Promise.all([
    httpGet(`${BASE}/upcoming/?limit=25&mode=normal&hide_recent_previous=true`, ctx).then((r) => r.json() as Promise<Ll2Page>),
    httpGet(`${BASE}/previous/?limit=15&mode=normal`, ctx).then((r) => r.json() as Promise<Ll2Page>),
  ]);
  return { upcoming: up.results ?? [], previous: prev.results ?? [] };
}
