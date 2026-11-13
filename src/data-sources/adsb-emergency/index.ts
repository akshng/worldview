/**
 * Aircraft broadcasting an emergency transponder code, from the community ADS-B
 * network adsb.lol (keyless, ODbL). 7700 general emergency, 7600 radio failure,
 * 7500 unlawful interference. Codes can be set briefly or in error; shown as reported.
 */
import type { EventCandidateInput } from "@/types/events";
import { httpGet, type DataSourceConnector, type FetchContext, type ParseContext, type ParseResult } from "../types";

export interface AdsbAircraft {
  hex: string;
  flight?: string;
  r?: string;
  t?: string;
  desc?: string;
  ownOp?: string;
  squawk?: string;
  emergency?: string;
  lat?: number;
  lon?: number;
  alt_baro?: number | "ground";
  gs?: number;
  seen?: number;
  seen_pos?: number;
}
export interface AdsbRaw {
  now: number;
  aircraft: AdsbAircraft[];
}

export const SQUAWKS: Record<string, string> = { "7700": "general emergency", "7600": "radio failure", "7500": "unlawful interference (hijack code)" };

export async function fetchAdsbEmergency(ctx: FetchContext): Promise<AdsbRaw> {
  const aircraft: AdsbAircraft[] = [];
  let now = ctx.now;
  for (const [i, code] of Object.keys(SQUAWKS).entries()) {
    // adsb.lol answers back-to-back requests with 429: space the three lookups a little.
    if (i > 0) await new Promise((r) => setTimeout(r, 1_100));
    const j = (await (await httpGet(`https://api.adsb.lol/v2/sqk/${code}`, ctx)).json()) as { ac?: AdsbAircraft[]; now?: number };
    if (typeof j.now === "number") now = j.now;
    aircraft.push(...(j.ac ?? []));
  }
  return { now, aircraft };
}

export function parseAdsbEmergency(raw: AdsbRaw, ctx: ParseContext): ParseResult {
  const candidates: EventCandidateInput[] = [];
  let skipped = 0;
  for (const a of raw.aircraft ?? []) {
    const meaning = a.squawk ? SQUAWKS[a.squawk] : undefined;
    if (!meaning || !/^[0-9a-f~]{6,7}$/i.test(a.hex) || !Number.isFinite(a.lat) || !Number.isFinite(a.lon) || (a.seen_pos ?? 0) > 120) {
      skipped++;
      continue;
    }
    const at = new Date((raw.now || ctx.now) - (a.seen_pos ?? a.seen ?? 0) * 1000);
    const callsign = a.flight?.trim() || null;
    const ident = callsign ?? a.r ?? a.hex.toUpperCase();
    const type = a.desc ?? a.t ?? null;
    const alt = a.alt_baro === "ground" ? "on the ground" : typeof a.alt_baro === "number" ? `at ${a.alt_baro.toLocaleString("en-US")} ft` : null;
    // One record per aircraft, code and UTC hour: position updates while the code is set.
    const key = `${a.hex.toLowerCase()}:${a.squawk}:${at.toISOString().slice(0, 13)}`;
    candidates.push({
      type: "AVIATION",
      subtype: "emergency squawk",
      title: `Aircraft squawking ${a.squawk} (${meaning}) — ${ident}${type ? ` (${type})` : ""}`,
      summary:
        `Community ADS-B receivers (adsb.lol) report ${ident}${a.r && a.r !== ident ? `, registration ${a.r}` : ""}${type ? `, a ${type}` : ""}` +
        ` transmitting transponder code ${a.squawk} (${meaning})${alt ? ` ${alt}` : ""} at ${at.toISOString().slice(0, 16).replace("T", " ")} UTC.` +
        " Crews sometimes set these codes briefly or in error; this is the broadcast code, not a confirmed incident.",
      latitude: a.lat!,
      longitude: a.lon!,
      geoPrecision: "exact",
      locationName: null,
      timestamp: at.toISOString(),
      metrics: { squawk: a.squawk ?? null, callsign, registration: a.r ?? null, aircraft_type: type, altitude_ft: typeof a.alt_baro === "number" ? a.alt_baro : null, ground_speed_kt: a.gs ?? null },
      entities: a.ownOp ? [{ type: "ORGANIZATION", name: a.ownOp, code: null }] : [],
      source: {
        id: `adsb-emergency:${key}`,
        dataSourceId: "adsb-emergency",
        externalId: key,
        sourceName: "adsb.lol community ADS-B network",
        sourceUrl: `https://adsb.lol/?icao=${encodeURIComponent(a.hex.toLowerCase())}`,
        title: null,
        titleIsDerived: true,
        publishedAt: at.toISOString(),
        retrievedAt: ctx.retrievedAt,
        sourceType: "COMMUNITY_DATABASE",
        assertion: "MEASUREMENT",
        credibility: { basis: "Volunteer ADS-B receivers decoding the aircraft's own broadcast (ODbL)" },
      },
      rawData: { hex: a.hex, squawk: a.squawk, flight: a.flight, r: a.r, t: a.t, alt_baro: a.alt_baro },
    });
  }
  return { candidates, skipped };
}

export const adsbEmergencyConnector: DataSourceConnector<AdsbRaw> = {
  id: "adsb-emergency",
  name: "Aircraft emergency squawks",
  description: "Aircraft currently transmitting transponder code 7700 (emergency), 7600 (radio failure) or 7500 (hijack) worldwide, from the adsb.lol community ADS-B network.",
  homepage: "https://adsb.lol/",
  attribution: "adsb.lol — Open Database License (ODbL)",
  sourceType: "COMMUNITY_DATABASE",
  categories: ["AVIATION"],
  // adsb.lol rate-limits (HTTP 429) at 2 min with one request per squawk code.
  refreshIntervalMs: 8 * 60_000,
  mode: "live",
  fetch: fetchAdsbEmergency,
  parse: parseAdsbEmergency,
};
