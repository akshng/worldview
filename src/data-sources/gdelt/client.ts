import { unzipSync, strFromU8 } from "fflate";
import { httpGet, type FetchContext } from "../types";
import type { GdeltEventRow, GdeltRaw } from "./types";

const LAST_UPDATE = "https://data.gdeltproject.org/gdeltv2/lastupdate.txt";
const FILE_BASE = "https://data.gdeltproject.org/gdeltv2/";
/** On first run, backfill this many 15-minute files (2 h). */
const BACKFILL_FILES = 8;
/** Never fetch more than this many files in one run. */
const MAX_FILES = 8;

function stamp(t: number): string {
  return new Date(t).toISOString().replace(/[-:T]/g, "").slice(0, 14);
}

function parseStamp(s: string): number {
  return Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +s.slice(8, 10), +s.slice(10, 12), +s.slice(12, 14));
}

/** Files to fetch: the latest, plus earlier 15-minute slots back to the last success (bounded). */
export function filesToFetch(latestUrl: string, lastSuccessAt: number | null): string[] {
  const m = latestUrl.match(/(\d{14})\.export\.CSV\.zip$/);
  if (!m) return [latestUrl];
  const latest = parseStamp(m[1]);
  const since = lastSuccessAt ? lastSuccessAt - 15 * 60_000 : latest - BACKFILL_FILES * 15 * 60_000;
  const urls: string[] = [];
  for (let t = latest, n = 0; t > since && n < MAX_FILES; t -= 15 * 60_000, n++) {
    urls.push(`${FILE_BASE}${stamp(t)}.export.CSV.zip`);
  }
  return urls;
}

const num = (s: string) => (s === "" ? NaN : Number(s));

export function parseExportTsv(text: string): GdeltEventRow[] {
  const rows: GdeltEventRow[] = [];
  for (const line of text.split("\n")) {
    if (!line) continue;
    const c = line.split("\t");
    if (c.length < 61) continue;
    rows.push({
      globalEventId: c[0],
      sqlDate: c[1],
      actor1Code: c[5],
      actor1Name: c[6],
      actor2Code: c[15],
      actor2Name: c[16],
      actor1Type: c[12],
      actor2Type: c[22],
      actor1Country: c[7],
      actor2Country: c[17],
      isRootEvent: c[25] === "1",
      eventCode: c[26],
      eventBaseCode: c[27],
      eventRootCode: c[28],
      quadClass: num(c[29]),
      goldstein: num(c[30]),
      numMentions: num(c[31]),
      numSources: num(c[32]),
      numArticles: num(c[33]),
      avgTone: num(c[34]),
      geoType: num(c[51]),
      geoName: c[52],
      geoFips: c[53],
      lat: num(c[56]),
      lon: num(c[57]),
      geoFeatureId: c[58],
      dateAdded: c[59],
      sourceUrl: c[60]?.trim() ?? "",
    });
  }
  return rows;
}

export async function fetchGdelt(ctx: FetchContext): Promise<GdeltRaw> {
  const index = await (await httpGet(LAST_UPDATE, ctx, { accept: "text/plain" })).text();
  const latest = index.split("\n").find((l) => l.includes(".export.CSV.zip"))?.split(" ")[2]?.trim();
  if (!latest) throw new Error("GDELT lastupdate.txt did not list an export file");
  const files: GdeltRaw["files"] = [];
  for (const url of filesToFetch(latest.replace(/^http:/, "https:"), ctx.lastSuccessAt)) {
    try {
      const buf = new Uint8Array(await (await httpGet(url, ctx, { accept: "application/zip" })).arrayBuffer());
      const entries = unzipSync(buf);
      const name = Object.keys(entries)[0];
      if (name) files.push({ url, rows: parseExportTsv(strFromU8(entries[name])) });
    } catch (err) {
      // A single missing slot (GDELT occasionally skips one) shouldn't fail the run.
      if (url.includes(latest.slice(-30))) throw err;
    }
  }
  return { files };
}
