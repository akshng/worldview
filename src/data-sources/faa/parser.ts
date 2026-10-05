import type { EventCandidateInput } from "@/types/events";
import { airportByCode } from "@/lib/geo/gazetteer";
import { plainText, type ParseContext, type ParseResult } from "../types";
import type { FaaDelay, FaaRaw } from "./types";

const tag = (block: string, name: string) => block.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`))?.[1]?.trim() ?? "";
const blocks = (xml: string, name: string) => [...xml.matchAll(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, "g"))].map((m) => m[1]);

export function extractDelays(xml: string): FaaDelay[] {
  const out: FaaDelay[] = [];
  for (const b of blocks(xml, "Ground_Delay")) out.push({ airport: tag(b, "ARPT"), kind: "ground-delay", reason: tag(b, "Reason"), detail: `average ${tag(b, "Avg")}, max ${tag(b, "Max")}` });
  for (const b of blocks(xml, "Program")) out.push({ airport: tag(b, "ARPT"), kind: "ground-stop", reason: tag(b, "Reason"), detail: `until ${tag(b, "End_Time")}` });
  for (const b of blocks(xml, "Airport")) {
    const arpt = tag(b, "ARPT");
    if (!arpt) continue;
    if (/<Arrival_Departure/.test(b)) {
      const ad = tag(b, "Arrival_Departure");
      out.push({ airport: arpt, kind: "arrival-departure-delay", reason: tag(b, "Reason"), detail: `${tag(ad, "Min")}–${tag(ad, "Max")} (${tag(b, "Arrival_Departure").match(/Type="([^"]+)"/)?.[1] ?? "delays"})` });
    } else if (/CLSD|closed/i.test(tag(b, "Reason"))) {
      // NOTAM-style closure text: only full aerodrome closures are events (not GA restrictions).
      const reason = tag(b, "Reason");
      if (/AD AP CLSD(?! TO )/.test(reason)) out.push({ airport: arpt, kind: "closure", reason: "airport closed", detail: plainText(reason, 200) });
    }
  }
  return out.filter((d) => d.airport);
}

const LABEL: Record<FaaDelay["kind"], string> = {
  "ground-delay": "Ground delay program",
  "ground-stop": "Ground stop",
  closure: "Airport closure",
  "arrival-departure-delay": "Arrival/departure delays",
};

export function parseFaa(raw: FaaRaw, ctx: ParseContext): ParseResult {
  const updated = tag(raw.xml, "Update_Time");
  const updatedAt = Number.isNaN(Date.parse(updated)) ? ctx.retrievedAt : new Date(updated).toISOString();
  const day = updatedAt.slice(0, 10);
  const candidates: EventCandidateInput[] = [];
  let skipped = 0;
  for (const d of extractDelays(raw.xml)) {
    const ap = airportByCode(d.airport);
    if (!ap) {
      skipped++;
      continue;
    }
    const externalId = `${d.airport}-${d.kind}-${day}`;
    candidates.push({
      type: "AVIATION",
      subtype: d.kind,
      title: `${LABEL[d.kind]} at ${ap.name} (${d.airport})`,
      summary: `The FAA reports a ${LABEL[d.kind].toLowerCase()} at ${ap.name}${d.reason ? ` due to ${d.reason}` : ""}${d.detail ? ` (${d.detail})` : ""}, as of ${updatedAt.slice(11, 16)} UTC.`,
      latitude: ap.lat,
      longitude: ap.lon,
      geoPrecision: "exact",
      locationName: `${ap.name}${ap.city ? `, ${ap.city}` : ""}`,
      country: ap.country,
      city: ap.city,
      timestamp: updatedAt,
      metrics: { airport: d.airport, reason: d.reason || null, delay: d.detail || null, large_airport: ap.large },
      entities: [{ type: "LOCATION", name: ap.name, code: d.airport }],
      source: {
        id: `faa:${externalId}`,
        dataSourceId: "faa",
        externalId,
        sourceName: "FAA NAS Status",
        sourceUrl: "https://nasstatus.faa.gov/",
        title: null,
        titleIsDerived: false,
        publishedAt: updatedAt,
        retrievedAt: ctx.retrievedAt,
        sourceType: "OFFICIAL_AGENCY",
        assertion: "OFFICIAL_PRELIMINARY",
        credibility: { basis: "U.S. Federal Aviation Administration" },
      },
      rawData: d,
    });
  }
  return { candidates, skipped };
}
