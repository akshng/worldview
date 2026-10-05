import type { EventCandidateInput } from "@/types/events";
import { safeUrl, type ParseContext, type ParseResult } from "../types";
import type { UsgsVolcanoRaw } from "./types";

const LEVEL_TEXT: Record<string, string> = {
  ADVISORY: "elevated unrest above known background",
  WATCH: "heightened or escalating unrest, or an eruption with limited hazards",
  WARNING: "a hazardous eruption is imminent, under way or suspected",
};

export function parseUsgsVolcano(raw: UsgsVolcanoRaw, ctx: ParseContext): ParseResult {
  const candidates: EventCandidateInput[] = [];
  let skipped = 0;
  for (const v of raw.elevated ?? []) {
    const i = raw.info?.[v.vnum];
    if (!i || !Number.isFinite(i.latitude) || !Number.isFinite(i.longitude)) {
      skipped++;
      continue;
    }
    const level = (v.alert_level ?? "").toUpperCase();
    const color = (v.color_code ?? "").toUpperCase();
    const sent = new Date(`${v.sent_utc.replace(" ", "T")}Z`);
    if (Number.isNaN(sent.getTime())) {
      skipped++;
      continue;
    }
    const meaning = LEVEL_TEXT[level];
    candidates.push({
      type: "VOLCANO",
      subtype: level === "WARNING" ? "eruption" : "volcanic-unrest",
      title: `${v.volcano_name} volcano — ${color ? `${color.toLowerCase()} aviation code, ` : ""}${level.toLowerCase() || "elevated"} alert`,
      summary:
        `The ${v.obs_fullname} has ${v.volcano_name} at volcano alert level ${level || "unknown"}` +
        `${color ? ` and aviation color code ${color}` : ""}` +
        `${meaning ? ` (${meaning})` : ""}. Latest notice issued ${sent.toISOString().replace("T", " ").slice(0, 16)} UTC.`,
      latitude: i.latitude,
      longitude: i.longitude,
      geoPrecision: "exact",
      locationName: [v.volcano_name, i.region].filter(Boolean).join(", "),
      country: "US",
      timestamp: sent.toISOString(),
      metrics: { alert_level: level || null, aviation_color_code: color || null, elevation_m: i.elevation_meters ?? null },
      entities: [{ type: "ORGANIZATION", name: v.obs_fullname, code: v.obs_abbr?.toUpperCase() ?? null }],
      source: {
        id: `usgs-volcano:${v.vnum}`,
        dataSourceId: "usgs-volcano",
        externalId: v.vnum,
        sourceName: `USGS Volcano Hazards Program — ${v.obs_fullname}`,
        sourceUrl: safeUrl(v.notice_url),
        title: null,
        titleIsDerived: true,
        publishedAt: sent.toISOString(),
        retrievedAt: ctx.retrievedAt,
        sourceType: "OFFICIAL_AGENCY",
        assertion: "OFFICIAL_FINAL",
        credibility: { basis: "U.S. federal volcano observatory (USGS)" },
      },
      rawData: v,
    });
  }
  return { candidates, skipped };
}
