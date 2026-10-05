import type { EventCandidateInput, EventCategory } from "@/types/events";
import { plainText, safeUrl, type ParseContext, type ParseResult } from "../types";
import type { GdacsCollection } from "./types";

const TYPES: Record<string, { type: EventCategory; subtype: string; noun: string }> = {
  EQ: { type: "EARTHQUAKE", subtype: "earthquake", noun: "earthquake" },
  TC: { type: "WEATHER", subtype: "tropical-cyclone", noun: "tropical cyclone" },
  FL: { type: "FLOOD", subtype: "flood", noun: "flood" },
  VO: { type: "VOLCANO", subtype: "eruption", noun: "volcanic activity" },
  DR: { type: "DISASTER", subtype: "drought", noun: "drought" },
  WF: { type: "FIRE", subtype: "wildfire", noun: "wildfire" },
};

/** GDACS timestamps have no zone designator; they are UTC. */
const utc = (s: string) => (s ? new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s}Z`).toISOString() : null);

export function parseGdacs(fc: GdacsCollection, ctx: ParseContext): ParseResult {
  const candidates: EventCandidateInput[] = [];
  let skipped = 0;
  for (const f of fc.features ?? []) {
    const p = f.properties;
    const t = TYPES[p.eventtype];
    const [lon, lat] = f.geometry?.coordinates ?? [];
    if (!t || !Number.isFinite(lat) || !Number.isFinite(lon)) {
      skipped++;
      continue;
    }
    const from = utc(p.fromdate)!;
    const to = utc(p.todate);
    const modified = utc(p.datemodified) ?? from;
    const now = ctx.now;
    // Most recent activity: forecast start, ended time, or last modification while ongoing.
    const timestamp =
      Date.parse(from) > now ? from : to && Date.parse(to) <= now ? to : new Date(Math.min(Date.parse(modified), now)).toISOString();
    const current = p.iscurrent === "true";
    const sev = p.severitydata;
    const metrics: Record<string, number | string | boolean | null> = {
      alert_level: p.alertlevel?.toLowerCase() ?? null,
      gdacs_alert_score: p.alertscore,
      started_at: from,
    };
    if (p.eventtype === "EQ" && sev?.severity) metrics.magnitude = Math.round(sev.severity * 10) / 10;
    if (p.eventtype === "TC" && sev?.severity) metrics.wind_kts = Math.round(sev.severity / 1.852); // km/h → kt
    if (p.eventtype === "WF" && sev?.severity && sev.severityunit === "ha") metrics.area_km2 = Math.round(sev.severity) / 100;
    const name = p.eventname?.trim();
    const countryName = p.country?.trim() || p.affectedcountries?.[0]?.countryname || null;
    const title =
      p.eventtype === "EQ" && typeof metrics.magnitude === "number"
        ? `M ${(metrics.magnitude as number).toFixed(1)} earthquake — ${countryName ?? p.name}`
        : name
          ? `${t.noun.charAt(0).toUpperCase() + t.noun.slice(1)} ${name}${countryName ? ` — ${countryName}` : ""}`
          : p.eventtype === "WF" && typeof metrics.area_km2 === "number"
            ? `${plainText(p.name, 160)} (${Math.round((metrics.area_km2 as number) * 100).toLocaleString("en-US")} ha)`
            : plainText(p.name, 200);
    const forecast = Date.parse(from) > now;
    candidates.push({
      type: t.type,
      subtype: forecast ? `${t.subtype}-forecast` : t.subtype,
      title,
      summary:
        `GDACS reports ${forecast ? "a forecast " : ""}${t.noun}${name ? ` (${name})` : ""}${countryName ? ` affecting ${countryName}` : ""} ` +
        `with a ${p.alertlevel} alert level${sev?.severitytext ? ` (${plainText(sev.severitytext, 120)})` : ""}. ` +
        `${forecast ? "Expected" : "Active"} from ${from.slice(0, 16).replace("T", " ")} UTC${to ? ` to ${to.slice(0, 16).replace("T", " ")} UTC` : ""}.`,
      latitude: lat,
      longitude: lon,
      geoPrecision: p.eventtype === "EQ" || p.eventtype === "VO" ? "exact" : "approximate",
      locationName: countryName,
      country: p.affectedcountries?.length === 1 ? p.affectedcountries[0].iso2 : null,
      timestamp,
      resolvedAt: !current && to ? to : null,
      metrics,
      entities: (p.affectedcountries ?? []).map((c) => ({ type: "COUNTRY" as const, name: c.countryname, code: c.iso2 })),
      source: {
        id: `gdacs:${p.eventtype}-${p.eventid}`,
        dataSourceId: "gdacs",
        externalId: `${p.eventtype}-${p.eventid}`,
        sourceName: "GDACS (UN / European Commission)",
        sourceUrl: safeUrl(p.url?.report),
        title: plainText(p.htmldescription, 300) || null,
        titleIsDerived: false,
        publishedAt: modified,
        retrievedAt: ctx.retrievedAt,
        sourceType: "OFFICIAL_AGENCY",
        assertion: "OFFICIAL_PRELIMINARY",
        credibility: { basis: "Automated alert system of the UN and European Commission" },
      },
      rawData: { eventtype: p.eventtype, eventid: p.eventid, episodeid: p.episodeid, alertlevel: p.alertlevel, source: p.source },
    });
  }
  return { candidates, skipped };
}
