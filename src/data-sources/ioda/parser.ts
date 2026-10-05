import type { EventCandidateInput } from "@/types/events";
import { getCountry } from "@/lib/geo/gazetteer";
import type { ParseContext, ParseResult } from "../types";
import type { IodaEvent, IodaResponse } from "./types";

const SIGNAL: Record<string, string> = {
  bgp: "BGP routing visibility",
  "ping-slash24": "active probing (ping) of address blocks",
  gtr: "Google Transparency Report traffic",
  "merit-nt": "network telescope traffic",
};

/** Several signals often flag the same outage; keep the strongest per country & start hour. */
function collapse(events: IodaEvent[]): IodaEvent[] {
  const best = new Map<string, IodaEvent>();
  for (const e of events) {
    const k = `${e.location}|${Math.floor(e.start / 3600)}`;
    const cur = best.get(k);
    if (!cur || e.score > cur.score) best.set(k, e);
  }
  return [...best.values()];
}

export function parseIoda(res: IodaResponse, ctx: ParseContext): ParseResult {
  const candidates: EventCandidateInput[] = [];
  const all = res.data ?? [];
  const events = collapse(all);
  let skipped = all.length - events.length;
  for (const e of events) {
    const code = e.location.split("/")[1];
    const country = code ? getCountry(code) : undefined;
    // Very long "outages" are usually measurement artefacts; very low scores are noise.
    if (!country || e.score < 1000 || e.duration < 20 * 60 || e.duration > 14 * 86_400) {
      skipped++;
      continue;
    }
    const start = new Date(e.start * 1000);
    const end = new Date((e.start + e.duration) * 1000);
    const ongoing = end.getTime() > ctx.now - 15 * 60_000;
    const hours = Math.round((e.duration / 3600) * 10) / 10;
    candidates.push({
      type: "INFRASTRUCTURE",
      subtype: "internet-outage",
      title: `Internet disruption detected in ${country.name}`,
      summary:
        `IODA detected a drop in ${SIGNAL[e.datasource] ?? e.datasource} for ${country.name} starting ${start.toISOString().slice(0, 16).replace("T", " ")} UTC` +
        `${ongoing ? " (ongoing)" : `, lasting about ${hours} h`}. Detection is automated and indicates connectivity loss, not its cause.`,
      latitude: country.label[1],
      longitude: country.label[0],
      geoPrecision: "country",
      locationName: country.name,
      country: country.code,
      timestamp: start.toISOString(),
      resolvedAt: ongoing ? null : end.toISOString(),
      metrics: { signal: e.datasource, ioda_score: Math.round(e.score), duration_h: hours },
      source: {
        id: `ioda:${e.location}-${e.start}`,
        dataSourceId: "ioda",
        externalId: `${e.location}-${e.start}`,
        sourceName: "IODA (Georgia Tech)",
        sourceUrl: `https://ioda.inetintel.cc.gatech.edu/country/${code}?from=${e.start - 3600}&until=${e.start + e.duration + 3600}`,
        title: null,
        titleIsDerived: false,
        publishedAt: start.toISOString(),
        retrievedAt: ctx.retrievedAt,
        sourceType: "SCIENTIFIC",
        assertion: "MEASUREMENT",
        credibility: { basis: "Academic internet measurement project (Georgia Institute of Technology)" },
      },
      rawData: e,
    });
  }
  return { candidates, skipped };
}
