import { httpGet, type FetchContext } from "../types";
import type { TsunamiRaw } from "./types";

const FEEDS = [
  { center: "National Tsunami Warning Center (Palmer, AK)", url: "https://www.tsunami.gov/events/xml/PAAQAtom.xml" },
  { center: "Pacific Tsunami Warning Center (Honolulu, HI)", url: "https://www.tsunami.gov/events/xml/PHEBAtom.xml" },
];

export async function fetchTsunami(ctx: FetchContext): Promise<TsunamiRaw> {
  const feeds = await Promise.all(FEEDS.map(async (f) => ({ center: f.center, xml: await (await httpGet(f.url, ctx, { accept: "application/atom+xml" })).text() })));
  return { feeds };
}
