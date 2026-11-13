import { unzipSync, strFromU8 } from "fflate";
import { httpGet, type FetchContext } from "../types";
import { fetchSlots, parseStamp, slotPlan, stamp } from "../gdelt/slots";
import type { GkgArticle, GkgLocation, GkgRaw } from "./types";

const BASE = "https://data.gdeltproject.org/gdeltv2/";
const BACKFILL_FILES = 4;
const MAX_FILES = 4;


/** Parse V2Locations: "type#name#fips#adm1#adm2#lat#lon#featureid#offset;…" (aggregated by place). */
export function parseLocations(field: string): GkgLocation[] {
  const byKey = new Map<string, GkgLocation>();
  for (const part of field.split(";")) {
    if (!part) continue;
    const c = part.split("#");
    const type = Number(c[0]), lat = Number(c[5]), lon = Number(c[6]);
    if (!type || !Number.isFinite(lat) || !Number.isFinite(lon) || c[5] === "") continue;
    const key = `${c[1]}|${type}`;
    const cur = byKey.get(key);
    if (cur) cur.mentions++;
    else byKey.set(key, { type, name: c[1], fips: c[2], lat, lon, mentions: 1 });
  }
  return [...byKey.values()];
}

const names = (field: string) => [...new Set(field.split(";").map((x) => x.split(",")[0].trim()).filter(Boolean))];

export function parseGkg(text: string): GkgArticle[] {
  const out: GkgArticle[] = [];
  for (const line of text.split("\n")) {
    if (!line) continue;
    const c = line.split("\t");
    if (c.length < 27 || c[2] !== "1") continue; // 1 = web news (not translated/other collections)
    out.push({
      date: c[1],
      source: c[3],
      url: c[4],
      title: c[26].match(/<PAGE_TITLE>([\s\S]*?)<\/PAGE_TITLE>/)?.[1] ?? null,
      themes: [...new Set((c[8] || c[7]).split(";").map((t) => t.split(",")[0]).filter(Boolean))],
      locations: parseLocations(c[10] || ""),
      persons: names(c[12] || c[11]),
      organizations: names(c[14] || c[13]),
      tone: c[15] ? Number(c[15].split(",")[0]) : null,
    });
  }
  return out;
}

export async function fetchGkg(ctx: FetchContext): Promise<GkgRaw> {
  const index = await (await httpGet(`${BASE}lastupdate.txt`, ctx, { accept: "text/plain" })).text();
  const latest = index.split("\n").find((l) => l.includes(".gkg.csv.zip"))?.match(/(\d{14})\.gkg\.csv\.zip/)?.[1];
  if (!latest) throw new Error("GDELT lastupdate.txt did not list a GKG file");
  const plan = slotPlan(parseStamp(latest), ctx.lastSuccessAt, { backfill: BACKFILL_FILES, max: MAX_FILES });
  const files: GkgRaw["files"] = await fetchSlots(
    plan,
    (t) => `${BASE}${stamp(t)}.gkg.csv.zip`,
    (buf, url) => {
      const entries = unzipSync(buf);
      const name = Object.keys(entries)[0];
      return name ? { url, articles: parseGkg(strFromU8(entries[name])) } : null;
    },
    ctx,
    "GKG",
  );
  return { files };
}
