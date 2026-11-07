/**
 * Earthquakes Canada (Natural Resources Canada, Canadian National Seismograph Network) FDSN
 * event web service, `format=text` (keyless): M2.5+ events of the past 3 days in and around
 * Canada. NRCan labels non-natural events in the place name: quarry blasts and explosions are
 * skipped; "suspected industry-related" and "mining-related" events are kept (they are real,
 * often felt seismic events) and said so in the summary. Place names are bilingual
 * ("107 km SSW of Port Alice, BC/107 km SSO de Port Alice, BC"); the English half is shown.
 */
import type { EventCandidateInput } from "@/types/events";
import { httpGet, type DataSourceConnector, type FetchContext, type ParseContext, type ParseResult } from "../types";
import { quakeCandidate } from "../quake-common";
import { fdsnTime, readFdsnText } from "../ingv";

export interface NrcanRaw {
  text: string;
}

export const NRCAN_MIN_MAG = 2.5;

export async function fetchNrcan(ctx: FetchContext): Promise<NrcanRaw> {
  const start = new Date(ctx.now - 3 * 86_400_000).toISOString().slice(0, 19);
  const res = await httpGet(`https://earthquakescanada.nrcan.gc.ca/fdsnws/event/1/query?format=text&minmagnitude=${NRCAN_MIN_MAG}&orderby=time&starttime=${start}`, ctx, { accept: "text/plain" });
  return { text: res.status === 204 ? "" : await res.text() };
}

/** "Quarry blast" / "Explosion" → skip; "industry-related" / "mining-related" → induced. */
export function nrcanKind(place: string): "blast" | "induced" | "natural" {
  if (/\b(quarry blast|blast|explosion)\b/i.test(place)) return "blast";
  if (/\b(industry|mining)-related\b/i.test(place)) return "induced";
  return "natural";
}

export function parseNrcan(raw: NrcanRaw, ctx: ParseContext): ParseResult {
  const candidates: EventCandidateInput[] = [];
  const { rows, bad } = readFdsnText(raw.text);
  let skipped = bad;
  for (const r of rows) {
    const t = fdsnTime(r.time);
    const en = (r.place ?? "").split("/")[0].trim() || null;
    const kind = nrcanKind(en ?? "");
    if (!/^ca\d{4}[a-z]+$/.test(r.id) || Number.isNaN(t) || r.mag < NRCAN_MIN_MAG || kind === "blast") {
      skipped++;
      continue;
    }
    // "Suspected industry-related event, 36 km WNW of Fox Creek, AB" → "36 km WNW of Fox Creek, AB"
    const place = kind === "induced" ? (en!.replace(/^[^,]*(industry|mining)-related event,?\s*/i, "").trim() || en) : en;
    const c = quakeCandidate({
      dataSourceId: "nrcan-quakes",
      externalId: r.id,
      sourceName: "Earthquakes Canada (Natural Resources Canada)",
      agency: "Earthquakes Canada (NRCan)",
      sourceUrl: "https://earthquakescanada.nrcan.gc.ca/recent/index-en.php",
      credibilityBasis: "Government of Canada national seismograph network (Natural Resources Canada)",
      assertion: "OFFICIAL_PRELIMINARY",
      when: new Date(t),
      retrievedAt: ctx.retrievedAt,
      latitude: r.lat,
      longitude: r.lon,
      magnitude: r.mag,
      magnitudeType: r.magType?.replace(/'$/, "") ?? null,
      depthKm: r.depthKm,
      place,
      extraSummary: kind === "induced" ? `NRCan classes it as: ${en}.` : undefined,
      extraMetrics: { induced: kind === "induced" },
      rawData: { id: r.id, time: r.time, magType: r.magType, place: r.place },
    });
    if (kind === "induced") c.subtype = "induced earthquake";
    candidates.push(c);
  }
  return { candidates, skipped };
}

export const nrcanQuakesConnector: DataSourceConnector<NrcanRaw> = {
  id: "nrcan-quakes",
  name: "Earthquakes Canada",
  description: "Magnitude 2.5+ earthquakes in and around Canada from Natural Resources Canada's national seismograph network (past 3 days); blasts skipped, induced events labelled.",
  homepage: "https://earthquakescanada.nrcan.gc.ca/",
  attribution: "Earthquakes Canada, Natural Resources Canada — Open Government Licence – Canada",
  sourceType: "OFFICIAL_AGENCY",
  categories: ["EARTHQUAKE"],
  refreshIntervalMs: 5 * 60_000,
  mode: "live",
  fetch: fetchNrcan,
  parse: parseNrcan,
};
