import type { EventCandidateInput, EventCategory } from "@/types/events";
import { plainText, safeUrl, type ParseContext, type ParseResult } from "../types";
import type { NwsAlertCollection, NwsAlertFeature } from "./types";

/** Area-weighted-ish centroid: mean of outer-ring vertices (adequate for alert polygons). */
export function polygonCentroid(g: NonNullable<NwsAlertFeature["geometry"]>): [number, number] | null {
  const rings = g.type === "Polygon" ? [g.coordinates[0]] : g.coordinates.map((p) => p[0]);
  let x = 0, y = 0, n = 0;
  for (const ring of rings)
    for (const [lon, lat] of ring) {
      x += lon;
      y += lat;
      n++;
    }
  return n ? [x / n, y / n] : null;
}

function categorize(event: string): { type: EventCategory; subtype: string } {
  const e = event.toLowerCase();
  if (e.includes("flood")) return { type: "FLOOD", subtype: e.includes("flash") ? "flash-flood" : "flood" };
  if (e.includes("tsunami")) return { type: "WEATHER", subtype: "tsunami" };
  if (e.includes("red flag") || e.includes("fire weather")) return { type: "WEATHER", subtype: "fire-weather" };
  if (e.includes("hurricane") || e.includes("tropical storm") || e.includes("typhoon")) return { type: "WEATHER", subtype: "tropical-cyclone" };
  if (e.includes("tornado")) return { type: "WEATHER", subtype: "tornado" };
  if (e.includes("heat")) return { type: "WEATHER", subtype: "extreme-heat" };
  if (e.includes("winter") || e.includes("blizzard") || e.includes("snow") || e.includes("ice") || e.includes("freeze")) return { type: "WEATHER", subtype: "winter" };
  if (e.includes("emergency")) return { type: "INFRASTRUCTURE", subtype: "civil-emergency" };
  return { type: "WEATHER", subtype: e.replace(/\s+(warning|watch|advisory|statement)$/, "").replace(/\s+/g, "-") };
}

export function parseNwsAlerts(fc: NwsAlertCollection, ctx: ParseContext): ParseResult {
  const candidates: EventCandidateInput[] = [];
  let skipped = 0;
  for (const f of fc.features ?? []) {
    const p = f.properties;
    // Zone-only alerts have no polygon; resolving zones would cost one request each.
    const c = f.geometry ? polygonCentroid(f.geometry) : null;
    if (!c || p.status !== "Actual") {
      skipped++;
      continue;
    }
    const { type, subtype } = categorize(p.event);
    const area = p.areaDesc.length > 120 ? `${p.areaDesc.slice(0, 117)}…` : p.areaDesc;
    // Cancellations end the alert now; otherwise use the stated end/expiry.
    const end = p.messageType === "Cancel" ? p.sent : (p.ends ?? p.expires);
    candidates.push({
      type,
      subtype,
      title: `${p.event} — ${area}`,
      summary:
        `${p.senderName} issued a ${p.event} (${p.severity.toLowerCase()} severity, ${p.urgency.toLowerCase()} urgency, ` +
        `certainty: ${p.certainty.toLowerCase()}) for ${area}` +
        `${end ? `, in effect until ${new Date(end).toISOString().replace("T", " ").slice(0, 16)} UTC` : ""}.`,
      description: plainText(p.description, 1500) || null,
      latitude: c[1],
      longitude: c[0],
      geoPrecision: "region",
      locationName: area,
      country: "US",
      timestamp: new Date(p.effective ?? p.sent).toISOString(),
      resolvedAt: end ? new Date(end).toISOString() : null,
      metrics: { event_name: p.event, severity: p.severity, urgency: p.urgency, certainty: p.certainty },
      // Updates/cancellations replace the earlier alert messages they reference.
      supersedes: (p.references ?? []).map((r) => `nws:${r.identifier}`),
      entities: [{ type: "ORGANIZATION", name: p.senderName, code: null }],
      source: {
        id: `nws:${p.id}`,
        dataSourceId: "nws",
        externalId: p.id,
        sourceName: "U.S. National Weather Service",
        sourceUrl: safeUrl(p["@id"]),
        title: p.headline,
        titleIsDerived: false,
        publishedAt: new Date(p.sent).toISOString(),
        retrievedAt: ctx.retrievedAt,
        sourceType: "OFFICIAL_AGENCY",
        assertion: "OFFICIAL_PRELIMINARY",
        credibility: { basis: "Official NWS alert product (forecast/warning)" },
      },
      rawData: { id: p.id, event: p.event, sent: p.sent, areaDesc: p.areaDesc, messageType: p.messageType },
    });
  }
  return { candidates, skipped, warnings: skipped ? [`${skipped} alerts skipped (zone-only, no polygon)`] : [] };
}
