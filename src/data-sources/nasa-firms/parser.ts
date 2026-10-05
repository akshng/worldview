/**
 * FIRMS detections → fire activity events.
 *
 * Individual hotspots (tens of thousands per day) are clustered into connected
 * groups on a 0.1° grid (8-neighbour flood fill). Only clusters above a size /
 * radiative-power threshold become events; each is keyed by UTC day + 0.5° cell
 * of its hottest pixel so later passes update the same event.
 */
import type { EventCandidateInput } from "@/types/events";
import type { ParseContext, ParseResult } from "../types";
import type { FirmsDetection, FirmsRaw } from "./types";

const CELL = 0.1;
const MIN_DETECTIONS = 20;
const MIN_FRP_MW = 400;

export interface FireCluster {
  detections: FirmsDetection[];
  lat: number;
  lon: number;
  frpTotal: number;
  frpMax: number;
  hottest: FirmsDetection;
  first: number;
  last: number;
  highConfidence: number;
}

export function clusterDetections(dets: FirmsDetection[]): FireCluster[] {
  const cells = new Map<string, FirmsDetection[]>();
  for (const d of dets) {
    if (d.confidence === "low") continue;
    const k = `${Math.floor(d.lat / CELL)}:${Math.floor(d.lon / CELL)}`;
    const arr = cells.get(k);
    if (arr) arr.push(d);
    else cells.set(k, [d]);
  }
  const seen = new Set<string>();
  const clusters: FireCluster[] = [];
  for (const start of cells.keys()) {
    if (seen.has(start)) continue;
    const stack = [start];
    seen.add(start);
    const members: FirmsDetection[] = [];
    while (stack.length) {
      const k = stack.pop()!;
      members.push(...cells.get(k)!);
      const [a, b] = k.split(":").map(Number);
      for (let da = -1; da <= 1; da++)
        for (let db = -1; db <= 1; db++) {
          const n = `${a + da}:${b + db}`;
          if (!seen.has(n) && cells.has(n)) {
            seen.add(n);
            stack.push(n);
          }
        }
    }
    let frpTotal = 0, latSum = 0, lonSum = 0, w = 0, high = 0;
    let hottest = members[0], first = Infinity, last = -Infinity;
    for (const m of members) {
      frpTotal += m.frp;
      const wt = Math.max(m.frp, 0.5);
      latSum += m.lat * wt;
      lonSum += m.lon * wt;
      w += wt;
      if (m.frp > hottest.frp) hottest = m;
      if (m.confidence === "high") high++;
      first = Math.min(first, m.acquiredAt);
      last = Math.max(last, m.acquiredAt);
    }
    clusters.push({ detections: members, lat: latSum / w, lon: lonSum / w, frpTotal, frpMax: hottest.frp, hottest, first, last, highConfidence: high });
  }
  return clusters;
}

export function parseFirms(raw: FirmsRaw, ctx: ParseContext): ParseResult {
  const clusters = clusterDetections(raw.detections);
  const significant = clusters.filter((c) => c.detections.length >= MIN_DETECTIONS || c.frpTotal >= MIN_FRP_MW);
  const candidates: EventCandidateInput[] = significant.map((c) => {
    const day = new Date(c.last).toISOString().slice(0, 10);
    const cellKey = `${Math.floor(c.hottest.lat / 0.5)}_${Math.floor(c.hottest.lon / 0.5)}`;
    const externalId = `${day}:${cellKey}`;
    const n = c.detections.length;
    const lastIso = new Date(c.last).toISOString();
    return {
      type: "FIRE",
      subtype: "satellite-detections",
      title: `Satellite-detected fire activity (${n} hotspots)`,
      summary:
        `NASA FIRMS (VIIRS S-NPP) recorded ${n} thermal anomalies in a connected area between ` +
        `${new Date(c.first).toISOString().slice(11, 16)} and ${lastIso.slice(11, 16)} UTC on ${day}, ` +
        `with total fire radiative power of ${Math.round(c.frpTotal).toLocaleString("en-US")} MW. ` +
        `Thermal anomalies usually indicate active fires, but can also be agricultural burning, gas flares or other heat sources.`,
      latitude: c.lat,
      longitude: c.lon,
      geoPrecision: "region",
      locationName: null,
      timestamp: lastIso,
      metrics: {
        detections: n,
        frp_total_mw: Math.round(c.frpTotal),
        frp_max_mw: Math.round(c.frpMax * 10) / 10,
        confidence_high: c.highConfidence,
        satellite: "VIIRS S-NPP",
      },
      entities: [{ type: "ORGANIZATION", name: "NASA FIRMS", code: null }],
      source: {
        id: `nasa-firms:${externalId}`,
        dataSourceId: "nasa-firms",
        externalId,
        sourceName: "NASA FIRMS (VIIRS S-NPP NRT)",
        sourceUrl: `https://firms.modaps.eosdis.nasa.gov/map/#d:${day};@${c.lon.toFixed(2)},${c.lat.toFixed(2)},9z`,
        title: null,
        titleIsDerived: false,
        publishedAt: lastIso,
        retrievedAt: ctx.retrievedAt,
        sourceType: "SATELLITE",
        assertion: "MEASUREMENT",
        credibility: { basis: "NASA satellite instrument detections (near real-time)" },
      },
      rawData: { detections: n, via: raw.via, hottest: c.hottest },
    };
  });
  return { candidates, skipped: raw.detections.length - significant.reduce((s, c) => s + c.detections.length, 0) };
}
