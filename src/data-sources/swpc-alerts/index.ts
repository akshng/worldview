/**
 * NOAA Space Weather Prediction Center alerts, watches and warnings (keyless JSON product
 * `alerts.json`, last ~7 days). Only messages at significant NOAA scale levels become events:
 * geomagnetic storms G2+, solar radiation storms S2+ and radio blackouts R3+ (X-class flares).
 * Space weather is planet-wide; records are shown at SWPC, Boulder, CO.
 */
import type { EventCandidateInput } from "@/types/events";
import { httpGet, type DataSourceConnector, type FetchContext, type ParseContext, type ParseResult } from "../types";
import { clip, makeSource } from "../official-common";

export interface SwpcAlert {
  product_id?: string;
  issue_datetime?: string;
  message?: string;
}

export interface SwpcRaw {
  alerts: SwpcAlert[];
}

const URL = "https://services.swpc.noaa.gov/products/alerts.json";
const SWPC = { lat: 39.995, lon: -105.263, name: "NOAA SWPC, Boulder, CO", country: "US" };
const MAX_AGE_MS = 3 * 86_400_000;
/** Lowest scale level kept per NOAA scale. */
const MIN_LEVEL: Record<string, number> = { G: 2, S: 2, R: 3 };
const SCALE_NAMES: Record<string, string> = { G: "geomagnetic storm", S: "solar radiation storm", R: "radio blackout" };

export async function fetchSwpc(ctx: FetchContext): Promise<SwpcRaw> {
  const json = (await (await httpGet(URL, ctx)).json()) as unknown;
  return { alerts: Array.isArray(json) ? (json as SwpcAlert[]) : [] };
}

export interface SwpcMessage {
  kind: "ALERT" | "WARNING" | "WATCH" | "SUMMARY" | "EXTENDED WARNING" | "CONTINUED ALERT" | "CANCEL";
  headline: string;
  serial: string | null;
  scale: string | null;
  level: number | null;
  scaleText: string | null;
}

/** Pull the headline, serial number and NOAA scale out of a SWPC message. */
export function parseSwpcMessage(message: string): SwpcMessage | null {
  const lines = message.split(/\r?\n/).map((l) => l.trim());
  const head = lines.find((l) => /^(EXTENDED WARNING|CONTINUED ALERT|ALERT|WARNING|WATCH|SUMMARY|CANCEL\b[^:]*):/i.test(l));
  if (!head) return null;
  const kindRaw = head.split(":")[0].toUpperCase();
  const kind = (kindRaw.startsWith("CANCEL") ? "CANCEL" : kindRaw) as SwpcMessage["kind"];
  const serial = message.match(/Serial Number:\s*(\d+)/i)?.[1] ?? null;
  const scaleLine = message.match(/NOAA Scale:\s*([GSR])(\d)\s*(?:-\s*([A-Za-z ]+))?/);
  const inHead = head.match(/\b(?:Category|Level)\s+([GSR])(\d)\b/i);
  const scale = scaleLine?.[1] ?? inHead?.[1]?.toUpperCase() ?? null;
  const level = scaleLine ? Number(scaleLine[2]) : inHead ? Number(inHead[2]) : null;
  return { kind, headline: head.slice(head.indexOf(":") + 1).trim(), serial, scale, level, scaleText: scaleLine?.[3]?.trim() ?? null };
}

export function parseSwpc(raw: SwpcRaw, ctx: ParseContext): ParseResult {
  const candidates: EventCandidateInput[] = [];
  let skipped = 0;
  const seen = new Set<string>();
  for (const a of raw.alerts ?? []) {
    const msg = a.message ? parseSwpcMessage(a.message) : null;
    // issue_datetime is UTC without a zone: "2026-10-29 03:10:22.317"
    const t = a.issue_datetime ? Date.parse(`${a.issue_datetime.trim().replace(" ", "T")}Z`) : NaN;
    if (!msg || msg.kind === "CANCEL" || !msg.scale || msg.level === null || msg.level < MIN_LEVEL[msg.scale] || Number.isNaN(t) || ctx.now - t > MAX_AGE_MS || t > ctx.now + 3_600_000) {
      skipped++;
      continue;
    }
    const externalId = `${a.product_id ?? "msg"}:${msg.serial ?? t}`;
    if (seen.has(externalId)) {
      skipped++;
      continue;
    }
    seen.add(externalId);
    const ts = new Date(t).toISOString();
    const scale = `${msg.scale}${msg.level}`;
    const kindLabel = msg.kind.toLowerCase();
    candidates.push({
      type: "SPACE",
      subtype: `space weather ${msg.kind === "WATCH" ? "watch" : msg.kind === "SUMMARY" ? "summary" : msg.kind.includes("WARNING") ? "warning" : "alert"}`,
      title: clip(`NOAA SWPC ${kindLabel}: ${msg.headline} (${scale}${msg.scaleText ? ` ${msg.scaleText}` : ""})`),
      summary: clip(
        `NOAA's Space Weather Prediction Center issued ${/^[aeiou]/i.test(kindLabel) ? "an" : "a"} ${kindLabel} at ${ts.slice(0, 16).replace("T", " ")} UTC: “${msg.headline}”. ` +
          `NOAA scale ${scale} (${SCALE_NAMES[msg.scale]}). Space weather affects the whole planet (aurora and HF radio at high latitudes first); shown at SWPC, Boulder.`,
        1990,
      ),
      description: a.message ? a.message.replace(/\r/g, "").slice(0, 1990) : null,
      latitude: SWPC.lat,
      longitude: SWPC.lon,
      geoPrecision: "approximate",
      locationName: "Global (issued by NOAA SWPC, Boulder, CO)",
      country: null,
      timestamp: ts,
      metrics: { noaa_scale: scale, scale_type: SCALE_NAMES[msg.scale], level: msg.level, message_type: msg.kind, product_id: a.product_id ?? null, serial: msg.serial },
      entities: [{ type: "ORGANIZATION", name: "NOAA Space Weather Prediction Center", code: "SWPC" }],
      source: makeSource({
        dataSourceId: "swpc-alerts",
        externalId,
        sourceName: "NOAA SWPC — alerts, watches and warnings",
        sourceUrl: "https://www.swpc.noaa.gov/products/alerts-watches-and-warnings",
        title: msg.headline,
        publishedAt: ts,
        retrievedAt: ctx.retrievedAt,
        assertion: msg.kind === "WATCH" || msg.kind.includes("WARNING") ? "OFFICIAL_PRELIMINARY" : "OFFICIAL_FINAL",
        basis: "U.S. federal agency (NOAA Space Weather Prediction Center)",
      }),
      rawData: { product_id: a.product_id ?? null, issue_datetime: a.issue_datetime, serial: msg.serial },
    });
  }
  return { candidates, skipped };
}

export const swpcAlertsConnector: DataSourceConnector<SwpcRaw> = {
  id: "swpc-alerts",
  name: "NOAA space weather alerts",
  description: "NOAA SWPC alerts, watches and warnings at G2+ geomagnetic storm, S2+ radiation storm or R3+ radio blackout level, last 3 days.",
  homepage: "https://www.swpc.noaa.gov/products/alerts-watches-and-warnings",
  attribution: "NOAA Space Weather Prediction Center — U.S. government data, public domain",
  sourceType: "OFFICIAL_AGENCY",
  categories: ["SPACE"],
  refreshIntervalMs: 10 * 60_000,
  mode: "live",
  fetch: fetchSwpc,
  parse: parseSwpc,
};
