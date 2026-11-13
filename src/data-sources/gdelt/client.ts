import { unzipSync, strFromU8 } from "fflate";
import { httpGet, type FetchContext } from "../types";
import type { GdeltEventRow, GdeltRaw } from "./types";
import { fetchSlots, parseStamp, slotPlan, stamp } from "./slots";

const LAST_UPDATE = "https://data.gdeltproject.org/gdeltv2/lastupdate.txt";
const FILE_BASE = "https://data.gdeltproject.org/gdeltv2/";
/** On first run, backfill this many 15-minute files (2 h). */
const BACKFILL_FILES = 8;
/** Never fetch more than this many files in one run. */
const MAX_FILES = 8;

/** Files to fetch: the latest, plus earlier 15-minute slots back to the last success (bounded). */
export function filesToFetch(latestUrl: string, lastSuccessAt: number | null): string[] {
  const m = latestUrl.match(/(\d{14})\.export\.CSV\.zip$/);
  if (!m) return [latestUrl];
  return slotPlan(parseStamp(m[1]), lastSuccessAt, { backfill: BACKFILL_FILES, max: MAX_FILES }).primary.map(exportUrl);
}

const exportUrl = (t: number) => `${FILE_BASE}${stamp(t)}.export.CSV.zip`;

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
  const m = latest.match(/(\d{14})\.export\.CSV\.zip$/);
  if (!m) throw new Error("GDELT lastupdate.txt listed an unexpected export file name");
  const plan = slotPlan(parseStamp(m[1]), ctx.lastSuccessAt, { backfill: BACKFILL_FILES, max: MAX_FILES });
  const files: GdeltRaw["files"] = await fetchSlots(
    plan,
    exportUrl,
    (buf, url) => {
      const entries = unzipSync(buf);
      const name = Object.keys(entries)[0];
      return name ? { url, rows: parseExportTsv(strFromU8(entries[name])) } : null;
    },
    ctx,
    "GDELT event",
  );
  return { files };
}
