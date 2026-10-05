import { unzipSync, strFromU8 } from "fflate";
import { httpGet, SourceHttpError, type FetchContext } from "../types";
import type { GkgArticle, GkgLocation, GkgRaw } from "./types";

const BASE = "https://data.gdeltproject.org/gdeltv2/";
const BACKFILL_FILES = 4;
const MAX_FILES = 4;

const stamp = (t: number) => new Date(t).toISOString().replace(/[-:T]/g, "").slice(0, 14);
const parseStamp = (s: string) => Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +s.slice(8, 10), +s.slice(10, 12), +s.slice(12, 14));

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
  const latestMs = parseStamp(latest);
  const since = ctx.lastSuccessAt ? ctx.lastSuccessAt - 15 * 60_000 : latestMs - BACKFILL_FILES * 15 * 60_000;
  const files: GkgRaw["files"] = [];
  for (let t = latestMs, n = 0; t > since && n < MAX_FILES; t -= 15 * 60_000, n++) {
    const url = `${BASE}${stamp(t)}.gkg.csv.zip`;
    try {
      const buf = new Uint8Array(await (await httpGet(url, ctx, { accept: "application/zip" })).arrayBuffer());
      const entries = unzipSync(buf);
      const name = Object.keys(entries)[0];
      if (name) files.push({ url, articles: parseGkg(strFromU8(entries[name])) });
    } catch (err) {
      // The newest slot is sometimes listed before it is published; skip missing slots.
      if (!(err instanceof SourceHttpError && err.status === 404)) throw err;
    }
  }
  if (!files.length) throw new Error("No GKG files available yet");
  return { files };
}
