/**
 * MeteoAlarm → WEATHER/FLOOD events (orange & red only).
 * Warning areas are region codes without published geometry, so each warning is
 * placed on a known city named in its area description when possible, else at
 * the country centre with country-level precision (shown as a wide ring).
 */
import type { EventCandidateInput, EventCategory } from "@/types/events";
import { AIRPORTS, CITIES, getCountry, regionsInText } from "@/lib/geo/gazetteer";
import { plainText, safeUrl, type ParseContext, type ParseResult } from "../types";
import type { MaInfo, MeteoAlarmRaw } from "./types";
import { meteoAlarmSeriesKey } from "@/lib/events/series";

const TYPES: Record<string, { type: EventCategory; subtype: string; label: string }> = {
  "1": { type: "WEATHER", subtype: "wind", label: "wind" },
  "2": { type: "WEATHER", subtype: "snow-ice", label: "snow/ice" },
  "3": { type: "WEATHER", subtype: "thunderstorm", label: "thunderstorm" },
  "4": { type: "WEATHER", subtype: "fog", label: "fog" },
  "5": { type: "WEATHER", subtype: "extreme-heat", label: "high temperature" },
  "6": { type: "WEATHER", subtype: "extreme-cold", label: "low temperature" },
  "7": { type: "WEATHER", subtype: "coastal", label: "coastal event" },
  "8": { type: "WEATHER", subtype: "fire-weather", label: "forest fire danger" },
  "9": { type: "WEATHER", subtype: "avalanche", label: "avalanche" },
  "10": { type: "WEATHER", subtype: "rain", label: "rain" },
  "12": { type: "FLOOD", subtype: "flood", label: "flooding" },
  "13": { type: "FLOOD", subtype: "rain-flood", label: "rain/flood" },
};

const param = (info: MaInfo, name: string) => info.parameter?.find((p) => p.valueName === name)?.value ?? "";

/** Prefer the English info block; fall back to the first. */
export function pickInfo(infos: MaInfo[]): MaInfo | undefined {
  return infos.find((i) => i.language?.toLowerCase().startsWith("en")) ?? infos[0];
}

export function placeFor(iso2: string, areas: string[]) {
  const country = getCountry(iso2);
  if (!country) return null;
  const text = ` ${areas.join(" / ").toLowerCase()} `;
  const hits = CITIES.filter((c) => c.country === iso2 && c.name.length >= 4 && new RegExp(`[^a-zà-ž]${c.name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^a-zà-ž]`).test(text));
  if (hits.length) {
    const lat = hits.reduce((s, c) => s + c.lat, 0) / hits.length, lon = hits.reduce((s, c) => s + c.lon, 0) / hits.length;
    return { lat, lon, precision: (hits.length === 1 ? "city" : "region") as "city" | "region", country };
  }
  // States / provinces / regions (incl. local and alternate names, e.g. "Sardegna").
  const regions = regionsInText(areas.join(" / "), iso2);
  if (regions.length) {
    return { lat: regions.reduce((s, r) => s + r.lat, 0) / regions.length, lon: regions.reduce((s, r) => s + r.lon, 0) / regions.length, precision: "region" as const, country };
  }
  // Smaller towns that have an airport.
  const towns = AIRPORTS.filter((a) => a.country === iso2 && a.city && a.city.length >= 4 && text.includes(` ${a.city.toLowerCase()} `));
  if (towns.length) {
    return { lat: towns[0].lat, lon: towns[0].lon, precision: "city" as const, country };
  }
  return { lat: country.label[1], lon: country.label[0], precision: "country" as const, country };
}

export function parseMeteoAlarm(raw: MeteoAlarmRaw, ctx: ParseContext): ParseResult {
  const candidates: EventCandidateInput[] = [];
  let skipped = 0;
  for (const c of raw.countries) {
    for (const w of c.warnings) {
      const info = w.alert?.info ? pickInfo(w.alert.info) : undefined;
      const level = info ? param(info, "awareness_level") : "";
      const levelNum = Number(level.split(";")[0]);
      const expires = info?.expires ? Date.parse(info.expires) : NaN;
      const cancelled = w.alert.msgType === "Cancel" || info?.responseType?.includes("AllClear");
      if (!info || levelNum < 3 || cancelled || !(expires > ctx.now)) {
        skipped++;
        continue;
      }
      const kind = TYPES[param(info, "awareness_type").split(";")[0].trim()] ?? { type: "WEATHER" as const, subtype: "weather", label: info.event ?? "weather" };
      const areas = [...new Set((info.area ?? []).map((a) => a.areaDesc).filter(Boolean))];
      const place = placeFor(c.iso2, areas);
      if (!place) {
        skipped++;
        continue;
      }
      const color = levelNum >= 4 ? "Red" : "Orange";
      const areaText = areas.length > 3 ? `${areas.slice(0, 3).join(", ")} +${areas.length - 3} more` : areas.join(", ");
      const onset = info.onset ?? info.effective ?? w.alert.sent ?? ctx.retrievedAt;
      candidates.push({
        type: kind.type,
        subtype: kind.subtype,
        title: `${color} ${kind.label} warning — ${areaText || place.country.name}, ${place.country.name}`,
        summary:
          `${info.senderName ?? "National weather service"} issued a ${color.toLowerCase()} ${kind.label} warning (${(info.severity ?? "").toLowerCase()} severity) ` +
          `for ${areaText || place.country.name}, valid until ${new Date(expires).toISOString().slice(0, 16).replace("T", " ")} UTC (via MeteoAlarm).`,
        description: plainText(info.description, 1200) || null,
        latitude: place.lat,
        longitude: place.lon,
        geoPrecision: place.precision,
        locationName: areaText || null,
        country: c.iso2,
        timestamp: new Date(onset).toISOString(),
        resolvedAt: new Date(expires).toISOString(),
        metrics: { alert_level: color.toLowerCase(), severity: info.severity ?? null, areas: areas.length },
        seriesKey: meteoAlarmSeriesKey(c.iso2, param(info, "awareness_type"), level, areas),
        entities: info.senderName ? [{ type: "ORGANIZATION", name: info.senderName, code: null }] : [],
        source: {
          id: `meteoalarm:${w.alert.identifier}`,
          dataSourceId: "meteoalarm",
          externalId: w.alert.identifier,
          sourceName: `${info.senderName ?? "National weather service"} via MeteoAlarm`,
          sourceUrl: safeUrl(info.web) ?? `https://meteoalarm.org/en/live/region/${c.iso2}`,
          title: info.headline ?? null,
          titleIsDerived: false,
          publishedAt: w.alert.sent ? new Date(w.alert.sent).toISOString() : ctx.retrievedAt,
          retrievedAt: ctx.retrievedAt,
          sourceType: "OFFICIAL_AGENCY",
          assertion: "OFFICIAL_PRELIMINARY",
          credibility: { basis: "National meteorological service (EUMETNET MeteoAlarm)" },
        },
        rawData: { identifier: w.alert.identifier, level, type: param(info, "awareness_type"), areas },
      });
    }
  }
  return { candidates, skipped };
}
