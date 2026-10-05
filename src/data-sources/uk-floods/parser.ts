import type { EventCandidateInput } from "@/types/events";
import { plainText, type ParseContext, type ParseResult } from "../types";
import type { UkFloodsRaw } from "./types";

const SEVERITY: Record<number, { label: string; meaning: string }> = {
  1: { label: "Severe flood warning", meaning: "severe flooding, danger to life" },
  2: { label: "Flood warning", meaning: "flooding is expected, immediate action required" },
  3: { label: "Flood alert", meaning: "flooding is possible, be prepared" },
};

/** EA timestamps have no zone designator; they are UK local time (GMT/BST). */
export function londonToUtc(s: string): Date {
  if (/[zZ]|[+-]\d\d:?\d\d$/.test(s)) return new Date(s);
  const asUtc = new Date(`${s}Z`);
  // Find London's offset at that instant (0 in winter, +1h in summer).
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", hourCycle: "h23" }).formatToParts(asUtc);
  const londonHour = Number(parts.find((p) => p.type === "hour")?.value);
  const offsetH = (londonHour - asUtc.getUTCHours() + 24) % 24;
  return new Date(asUtc.getTime() - offsetH * 3_600_000);
}

export function parseUkFloods(raw: UkFloodsRaw, ctx: ParseContext): ParseResult {
  const candidates: EventCandidateInput[] = [];
  let skipped = 0;
  for (const w of raw.items ?? []) {
    const sev = SEVERITY[w.severityLevel];
    const area = raw.areas?.[w.floodAreaID];
    if (!sev || !area || !Number.isFinite(area.lat) || !Number.isFinite(area.long)) {
      skipped++;
      continue;
    }
    const raised = londonToUtc(w.timeRaised ?? w.timeMessageChanged ?? "");
    if (Number.isNaN(raised.getTime())) {
      skipped++;
      continue;
    }
    const county = w.floodArea?.county ?? area.county ?? null;
    const message = plainText(w.message, 600);
    candidates.push({
      type: "FLOOD",
      subtype: w.isTidal ? "coastal-flood" : "river-flood",
      title: `${sev.label} — ${w.description}`,
      summary:
        `The Environment Agency issued a ${sev.label.toLowerCase()} (${sev.meaning}) for ${w.description}` +
        `${county ? `, ${county}` : ""}.${message ? ` Message: ${message}` : ""}`,
      latitude: area.lat,
      longitude: area.long,
      geoPrecision: "region",
      locationName: [w.description, county].filter(Boolean).join(", "),
      country: "GB",
      timestamp: raised.toISOString(),
      metrics: { severity_level: w.severityLevel, severity: sev.label, tidal: !!w.isTidal, river_or_sea: w.floodArea?.riverOrSea ?? null },
      entities: [{ type: "ORGANIZATION", name: "Environment Agency", code: null }],
      source: {
        // A new record per severity change, superseding the previous one for the same area.
        id: `uk-floods:${w.floodAreaID}:${w.severityLevel}`,
        dataSourceId: "uk-floods",
        externalId: `${w.floodAreaID}:${w.severityLevel}`,
        sourceName: "Environment Agency (England) flood warnings",
        sourceUrl: `https://check-for-flooding.service.gov.uk/target-area/${encodeURIComponent(w.floodAreaID)}`,
        title: `${w.severity}: ${w.description}`,
        titleIsDerived: false,
        publishedAt: londonToUtc(w.timeMessageChanged ?? w.timeRaised ?? "").toISOString(),
        retrievedAt: ctx.retrievedAt,
        sourceType: "OFFICIAL_AGENCY",
        assertion: "OFFICIAL_FINAL",
        credibility: { basis: "UK government agency (Environment Agency, England)" },
      },
      supersedes: [1, 2, 3].filter((l) => l !== w.severityLevel).map((l) => `uk-floods:${w.floodAreaID}:${l}`),
      rawData: { ...w, message: undefined },
    });
  }
  return { candidates, skipped };
}
