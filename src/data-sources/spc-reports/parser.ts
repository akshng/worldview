import type { EventCandidateInput } from "@/types/events";
import type { ParseContext, ParseResult } from "../types";
import type { SpcRaw } from "./types";

type Kind = "tornado" | "wind" | "hail";

/** Report day YYMMDD + HHMM → UTC. Times before 12:00 belong to the next calendar day. */
export function spcTime(day: string, hhmm: string): Date | null {
  if (!/^\d{6}$/.test(day) || !/^\d{3,4}$/.test(hhmm)) return null;
  const t = hhmm.padStart(4, "0");
  const base = Date.UTC(2000 + Number(day.slice(0, 2)), Number(day.slice(2, 4)) - 1, Number(day.slice(4, 6)), Number(t.slice(0, 2)), Number(t.slice(2, 4)));
  return new Date(Number(t.slice(0, 2)) < 12 ? base + 86_400_000 : base);
}

const titleCase = (s: string) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

/** "2 SW Rock Harbor" → "2 mi SW of Rock Harbor"; zone codes like "FLC087" in the county column are dropped. */
export function spcPlace(location: string, county: string, state: string): string {
  const m = location.trim().match(/^(\d+)\s+([NSEW]{1,3})\s+(.+)$/i);
  const loc = m ? `${m[1]} mi ${m[2].toUpperCase()} of ${titleCase(m[3])}` : titleCase(location.trim());
  const cty = /^[A-Z]{2}[CZ]\d{3}$/i.test(county.trim()) || !county.trim() ? null : `${titleCase(county.trim())} County`;
  return [loc, cty, state].filter(Boolean).join(", ");
}

export function parseSpc(raw: SpcRaw, ctx: ParseContext): ParseResult {
  const candidates: EventCandidateInput[] = [];
  let skipped = 0;
  for (const { day, csv } of raw.days ?? []) {
    let kind: Kind | null = null;
    for (const line of csv.split(/\r?\n/)) {
      if (!line.trim()) continue;
      if (line.startsWith("Time,F_Scale")) { kind = "tornado"; continue; }
      if (line.startsWith("Time,Speed")) { kind = "wind"; continue; }
      if (line.startsWith("Time,Size")) { kind = "hail"; continue; }
      if (!kind) continue;
      const [time, mag, location, county, state, latS, lonS, ...rest] = line.split(",");
      const lat = Number(latS), lon = Number(lonS);
      const at = spcTime(day, time);
      if (!at || !Number.isFinite(lat) || !Number.isFinite(lon) || !state) {
        skipped++;
        continue;
      }
      const comments = rest.join(",").trim();
      const place = spcPlace(location ?? "", county ?? "", state);
      const magNum = Number(mag);
      const detail =
        kind === "tornado"
          ? mag && mag !== "UNK" ? ` (${mag})` : ""
          : kind === "wind"
            ? Number.isFinite(magNum) ? ` — ${magNum} mph` : ""
            : Number.isFinite(magNum) ? ` — ${(magNum / 100).toFixed(2)} in` : "";
      const noun = kind === "tornado" ? "Tornado report" : kind === "wind" ? "Damaging wind report" : "Hail report";
      candidates.push({
        type: "WEATHER",
        subtype: kind === "tornado" ? "tornado" : kind === "wind" ? "severe-wind" : "hail",
        title: `${noun}${detail} — ${place}`,
        summary:
          `A preliminary ${kind} report was received by the NOAA Storm Prediction Center for ${place} at ${at.toISOString().slice(0, 16).replace("T", " ")} UTC.` +
          (comments ? ` Report notes: ${comments.slice(0, 500)}` : "") +
          " Local storm reports are preliminary and may be revised or removed after review.",
        latitude: lat,
        longitude: lon,
        geoPrecision: "city",
        locationName: place,
        country: "US",
        timestamp: at.toISOString(),
        metrics: {
          report_kind: kind,
          ...(kind === "tornado" ? { ef_scale: mag && mag !== "UNK" ? mag : null } : {}),
          ...(kind === "wind" ? { wind_mph: Number.isFinite(magNum) ? magNum : null } : {}),
          ...(kind === "hail" ? { hail_in: Number.isFinite(magNum) ? magNum / 100 : null } : {}),
        },
        entities: [{ type: "ORGANIZATION", name: "NOAA Storm Prediction Center", code: "SPC" }],
        source: {
          // No upstream id: report day + section + time + coordinates is unique within the file.
          id: `spc-reports:${day}:${kind}:${time}:${lat}:${lon}`,
          dataSourceId: "spc-reports",
          externalId: `${day}:${kind}:${time}:${lat}:${lon}`,
          sourceName: "NOAA Storm Prediction Center — local storm reports",
          sourceUrl: `https://www.spc.noaa.gov/climo/reports/${day}_rpts.html`,
          title: null,
          titleIsDerived: true,
          publishedAt: at.toISOString(),
          retrievedAt: ctx.retrievedAt,
          sourceType: "OFFICIAL_AGENCY",
          assertion: "OFFICIAL_PRELIMINARY",
          credibility: { basis: "U.S. federal forecast agency (NOAA National Weather Service); reports from spotters, officials and the public" },
        },
        rawData: { day, kind, time, mag, location, county, state },
      });
    }
  }
  return { candidates, skipped };
}
