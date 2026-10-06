/**
 * Hong Kong Observatory weather warnings in force (keyless open-data API):
 * `warnsum` (one entry per warning type, issue time with +08:00) plus `warningInfo`
 * (the warning text). HKO warnings cover the whole territory, so each is placed at
 * Hong Kong itself (city precision). Cancelled warnings are skipped.
 */
import type { EventCandidateInput, EventCategory } from "@/types/events";
import { httpGet, plainText, type DataSourceConnector, type FetchContext, type ParseContext, type ParseResult } from "../types";

export interface HkoWarning {
  name?: string;
  code?: string;
  type?: string;
  actionCode?: string;
  issueTime?: string;
  expireTime?: string;
  updateTime?: string;
}
export interface HkoRaw {
  summary: Record<string, HkoWarning>;
  details: { warningStatementCode?: string; subtype?: string; contents?: string[]; updateTime?: string }[];
}

const BASE = "https://data.weather.gov.hk/weatherAPI/opendata/weather.php";
/** Hong Kong Observatory, Tsim Sha Tsui */
const HK = { lat: 22.302, lon: 114.174 };

export async function fetchHko(ctx: FetchContext): Promise<HkoRaw> {
  const [summary, info] = await Promise.all([
    httpGet(`${BASE}?dataType=warnsum&lang=en`, ctx).then((r) => r.json()),
    httpGet(`${BASE}?dataType=warningInfo&lang=en`, ctx).then((r) => r.json()).catch(() => ({})),
  ]);
  return { summary: (summary ?? {}) as HkoRaw["summary"], details: ((info as { details?: HkoRaw["details"] })?.details ?? []) };
}

/** HKO warning statement code → category/subtype. */
export function categorizeHko(key: string): { type: EventCategory; subtype: string } {
  switch (key) {
    case "WTCSGNL": return { type: "WEATHER", subtype: "tropical-cyclone" };
    case "WRAIN": return { type: "WEATHER", subtype: "rainstorm" };
    case "WFNTSA": return { type: "FLOOD", subtype: "flood" };
    case "WL": return { type: "DISASTER", subtype: "landslip" };
    case "WTMW": return { type: "DISASTER", subtype: "tsunami" };
    case "WTS": return { type: "WEATHER", subtype: "thunderstorm" };
    case "WHOT": return { type: "WEATHER", subtype: "extreme-heat" };
    case "WCOLD": case "WFROST": return { type: "WEATHER", subtype: "winter" };
    case "WFIRE": return { type: "WEATHER", subtype: "fire-danger" };
    case "WMSGNL": return { type: "WEATHER", subtype: "monsoon" };
    default: return { type: "WEATHER", subtype: key.toLowerCase() };
  }
}

const TC_SIGNALS: Record<string, string> = {
  TC1: "No. 1 Standby Signal", TC3: "No. 3 Strong Wind Signal", TC8NE: "No. 8 Northeast Gale or Storm Signal", TC8SE: "No. 8 Southeast Gale or Storm Signal",
  TC8NW: "No. 8 Northwest Gale or Storm Signal", TC8SW: "No. 8 Southwest Gale or Storm Signal", TC9: "No. 9 Increasing Gale or Storm Signal", TC10: "No. 10 Hurricane Signal",
};

export function parseHko(raw: HkoRaw, ctx: ParseContext): ParseResult {
  const candidates: EventCandidateInput[] = [];
  let skipped = 0;
  for (const [key, w] of Object.entries(raw.summary ?? {})) {
    const issued = w?.issueTime ? new Date(w.issueTime) : null;
    if (!w?.name || !issued || Number.isNaN(issued.getTime()) || w.actionCode === "CANCEL") {
      skipped++;
      continue;
    }
    const expires = w.expireTime && !Number.isNaN(Date.parse(w.expireTime)) ? new Date(w.expireTime) : null;
    if (expires && expires.getTime() < ctx.now) {
      skipped++;
      continue;
    }
    const level = key === "WTCSGNL" && w.code ? (TC_SIGNALS[w.code] ?? w.code) : w.type ? `${w.type}` : null;
    const title = `${level ? `${w.name} — ${level}` : w.name} — Hong Kong`;
    const detail = (raw.details ?? []).find((d) => d.warningStatementCode === key);
    const text = plainText((detail?.contents ?? []).join(" "), 1500);
    const { type, subtype } = categorizeHko(key);
    const updated = w.updateTime && !Number.isNaN(Date.parse(w.updateTime)) ? new Date(w.updateTime) : issued;
    candidates.push({
      type,
      subtype,
      title,
      summary:
        `The Hong Kong Observatory has issued the ${w.name}${level ? ` (${level})` : ""} for Hong Kong, issued ${issued.toISOString().replace("T", " ").slice(0, 16)} UTC` +
        `${expires ? `, valid until ${expires.toISOString().replace("T", " ").slice(0, 16)} UTC` : ""}.`,
      description: text || null,
      latitude: HK.lat,
      longitude: HK.lon,
      geoPrecision: "city",
      locationName: "Hong Kong",
      country: "HK",
      city: "Hong Kong",
      timestamp: issued.toISOString(),
      resolvedAt: expires ? expires.toISOString() : null,
      metrics: { warning_code: w.code ?? null, warning_type: w.type ?? null, action: w.actionCode ?? null },
      entities: [{ type: "ORGANIZATION", name: "Hong Kong Observatory", code: "HKO" }],
      source: {
        // One record per warning type and issue time; a re-issued warning (e.g. a new signal) is a new record.
        id: `hko-warnings:${key}:${issued.toISOString()}`,
        dataSourceId: "hko-warnings",
        externalId: `${key}:${issued.toISOString()}`,
        sourceName: "Hong Kong Observatory — weather warnings",
        sourceUrl: "https://www.hko.gov.hk/en/wxinfo/warning/warn.htm",
        title,
        titleIsDerived: true,
        publishedAt: updated.toISOString(),
        retrievedAt: ctx.retrievedAt,
        sourceType: "OFFICIAL_AGENCY",
        assertion: "OFFICIAL_PRELIMINARY",
        credibility: { basis: "Hong Kong SAR Government weather service (Hong Kong Observatory)" },
      },
      rawData: { key, ...w },
    });
  }
  return { candidates, skipped };
}

export const hkoWarningsConnector: DataSourceConnector<HkoRaw> = {
  id: "hko-warnings",
  name: "Hong Kong Observatory warnings",
  description: "Weather warnings in force in Hong Kong: tropical cyclone signals, rainstorm, flooding, landslip, thunderstorm, heat/cold, fire danger and tsunami warnings.",
  homepage: "https://www.hko.gov.hk/en/wxinfo/warning/warn.htm",
  attribution: "Hong Kong Observatory open data — free use with attribution (DATA.GOV.HK terms)",
  sourceType: "OFFICIAL_AGENCY",
  categories: ["WEATHER", "FLOOD", "DISASTER"],
  refreshIntervalMs: 10 * 60_000,
  mode: "live",
  fetch: fetchHko,
  parse: parseHko,
};
