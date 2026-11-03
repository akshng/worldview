/**
 * Active tornado and severe thunderstorm watches from the NOAA Storm Prediction Center.
 * Geometry: the county polygons of each watch from the NWS watches/warnings ArcGIS layer
 * (`WWA/watch_warn_adv` layer 1, keyless), grouped by watch number into one MultiPolygon.
 * Text: the SPC watch RSS (`spcwwrss.xml`) — states, valid period, primary threats and the
 * "particularly dangerous situation" flag. One event per watch number per calendar year.
 *
 * NWS watches have no polygon of their own, so the `nws` connector (polygon alerts only)
 * does not carry them; `spc-reports` carries the storm reports that follow.
 */
import type { AreaGeometry, EventCandidateInput } from "@/types/events";
import { httpGet, type DataSourceConnector, type FetchContext, type ParseContext, type ParseResult } from "../types";
import { clip, makeSource, readFeedItems, type RssItem } from "../official-common";
import { polygonCentroid, simplifyArea } from "../weather/parser";

export interface WatchCounty {
  properties?: { prod_type?: string; phenom?: string; event?: string; issuance?: string; onset?: string; expiration?: string; ends?: string; wfo?: string };
  geometry?: { type: string; coordinates: unknown } | null;
}
export interface SpcWatchesRaw {
  counties: WatchCounty[];
  rss: RssItem[];
}

const LAYER_URL =
  "https://mapservices.weather.noaa.gov/eventdriven/rest/services/WWA/watch_warn_adv/MapServer/1/query?where=prod_type+IN+(%27Tornado+Watch%27,%27Severe+Thunderstorm+Watch%27)&outFields=prod_type,phenom,event,issuance,onset,expiration,ends,wfo&returnGeometry=true&outSR=4326&geometryPrecision=3&f=geojson";
const RSS_URL = "https://www.spc.noaa.gov/products/spcwwrss.xml";

export async function fetchSpcWatches(ctx: FetchContext): Promise<SpcWatchesRaw> {
  const [layer, rss] = await Promise.all([
    httpGet(LAYER_URL, ctx, { accept: "application/geo+json, application/json" }).then((r) => r.json() as Promise<{ features?: WatchCounty[] }>),
    httpGet(RSS_URL, ctx, { accept: "application/rss+xml, application/xml, text/xml" }).then(readFeedItems).catch(() => [] as RssItem[]),
  ]);
  return { counties: Array.isArray(layer.features) ? layer.features : [], rss };
}

export interface WatchText {
  number: number;
  kind: "tornado" | "severe thunderstorm";
  states: string[];
  threats: string[];
  pds: boolean;
  link: string;
  published: string | null;
}

/** Facts from one SPC watch RSS item ("WW 703 TORNADO AR KS MO OK 030135Z - 030900Z …"). */
export function readWatchItem(it: RssItem): WatchText | null {
  const head = it.description.match(/WW\s+(\d{1,4})\s+(TORNADO|SEVERE TSTM|SEVERE THUNDERSTORM)\s+([A-Z ]+?)\s+\d{6}Z/);
  const number = Number(head?.[1] ?? it.title.match(/Watch\s+(\d{1,4})/)?.[1]);
  if (!Number.isFinite(number) || number <= 0) return null;
  const kind = /tornado/i.test(head?.[2] ?? it.title) ? "tornado" : "severe thunderstorm";
  const states = (head?.[3] ?? "").split(/\s+/).filter((s) => /^[A-Z]{2}$/.test(s));
  const threatsBlock = it.description.replace(/\r/g, "").match(/Primary threats include\.\.\.\s*\n([\s\S]*?)\n\s*\n/i)?.[1] ?? "";
  const threats = threatsBlock.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 6);
  const t = it.published ? Date.parse(it.published) : NaN;
  return { number, kind, states, threats, pds: /PARTICULARLY DANGEROUS SITUATION/i.test(it.description), link: it.link, published: Number.isNaN(t) ? null : new Date(t).toISOString() };
}

type Ring = [number, number][];
const iso = (s: string | undefined) => {
  const t = s ? Date.parse(s) : NaN;
  return Number.isNaN(t) ? null : new Date(t).toISOString();
};

export function parseSpcWatches(raw: SpcWatchesRaw, ctx: ParseContext): ParseResult {
  const candidates: EventCandidateInput[] = [];
  let skipped = 0;
  const texts = new Map<number, WatchText>();
  for (const it of raw.rss ?? []) {
    const w = readWatchItem(it);
    if (w && !texts.has(w.number)) texts.set(w.number, w);
  }
  const groups = new Map<number, { kind: "tornado" | "severe thunderstorm"; polys: Ring[][]; issued: string | null; ends: string | null; wfos: Set<string> }>();
  for (const f of raw.counties ?? []) {
    const p = f.properties ?? {};
    const n = Number(p.event);
    const g = f.geometry;
    if (!Number.isFinite(n) || n <= 0 || !g) {
      skipped++;
      continue;
    }
    const cur = groups.get(n) ?? { kind: p.phenom === "TO" || /tornado/i.test(p.prod_type ?? "") ? "tornado" : "severe thunderstorm", polys: [], issued: null, ends: null, wfos: new Set<string>() };
    if (g.type === "Polygon") cur.polys.push(g.coordinates as Ring[]);
    else if (g.type === "MultiPolygon") cur.polys.push(...(g.coordinates as Ring[][]));
    const issued = iso(p.onset) ?? iso(p.issuance);
    if (issued && (!cur.issued || issued < cur.issued)) cur.issued = issued;
    const ends = iso(p.ends) ?? iso(p.expiration);
    if (ends && (!cur.ends || ends > cur.ends)) cur.ends = ends;
    if (p.wfo) cur.wfos.add(p.wfo.replace(/^K/, ""));
    groups.set(n, cur);
  }
  for (const [n, g] of groups) {
    const text = texts.get(n);
    const ts = text?.published ?? g.issued;
    if (!ts || !g.polys.length || (g.ends && Date.parse(g.ends) < ctx.now - 3_600_000)) {
      skipped++;
      continue;
    }
    const geometry: AreaGeometry = { type: "MultiPolygon", coordinates: g.polys };
    const c = polygonCentroid(geometry as Parameters<typeof polygonCentroid>[0]);
    if (!c) {
      skipped++;
      continue;
    }
    const kind = text?.kind ?? g.kind;
    const label = kind === "tornado" ? "Tornado Watch" : "Severe Thunderstorm Watch";
    const states = text?.states ?? [];
    const year = ts.slice(0, 4);
    candidates.push({
      type: "WEATHER",
      subtype: kind === "tornado" ? "tornado watch" : "severe thunderstorm watch",
      title: clip(`${text?.pds ? "PDS " : ""}${label} ${n}${states.length ? ` — ${states.join(", ")}` : ""}`),
      summary: clip(
        `The NWS Storm Prediction Center issued ${label} ${n}${states.length ? ` for parts of ${states.join(", ")}` : ""}` +
          `${g.ends ? `, valid until ${g.ends.slice(0, 16).replace("T", " ")} UTC` : ""}; ${g.polys.length} county area${g.polys.length > 1 ? "s" : ""}.` +
          `${text?.pds ? " This is a Particularly Dangerous Situation (PDS) watch." : ""}` +
          `${text?.threats.length ? ` Primary threats: ${text.threats.join("; ")}.` : ""} Shown with the watch counties.`,
        1990,
      ),
      description: null,
      latitude: c[1],
      longitude: c[0],
      geoPrecision: "region",
      geometry: simplifyArea(geometry as Parameters<typeof simplifyArea>[0]),
      locationName: states.length ? `${states.join(", ")} (watch area)` : "Watch area",
      country: "US",
      timestamp: ts,
      resolvedAt: g.ends,
      metrics: { watch_number: n, watch_type: kind, pds: text?.pds ?? false, counties: g.polys.length, states: states.join(" ") || null },
      entities: [{ type: "ORGANIZATION", name: "NWS Storm Prediction Center", code: "SPC" }],
      source: makeSource({
        dataSourceId: "spc-watches",
        externalId: `${year}:${n}`,
        sourceName: "NOAA Storm Prediction Center",
        sourceUrl: text?.link || `https://www.spc.noaa.gov/products/watch/ww${String(n).padStart(4, "0")}.html`,
        title: `${label} ${n}`,
        publishedAt: ts,
        retrievedAt: ctx.retrievedAt,
        assertion: "OFFICIAL_PRELIMINARY",
        basis: "U.S. federal agency (NOAA NWS Storm Prediction Center)",
      }),
      rawData: { watch: n, kind, issued: g.issued, ends: g.ends, wfos: [...g.wfos].slice(0, 10), threats: text?.threats ?? [] },
    });
  }
  return { candidates, skipped };
}

export const spcWatchesConnector: DataSourceConnector<SpcWatchesRaw> = {
  id: "spc-watches",
  name: "SPC tornado & severe thunderstorm watches",
  description: "Active NOAA Storm Prediction Center tornado and severe thunderstorm watches with their county areas, primary threats and PDS flag.",
  homepage: "https://www.spc.noaa.gov/products/watch/",
  attribution: "NOAA National Weather Service / Storm Prediction Center — public domain U.S. government data",
  sourceType: "OFFICIAL_AGENCY",
  categories: ["WEATHER"],
  refreshIntervalMs: 5 * 60_000,
  timeoutMs: 30_000,
  mode: "live",
  fetch: fetchSpcWatches,
  parse: parseSpcWatches,
};
