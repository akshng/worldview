import type { EventCandidateInput } from "@/types/events";
import type { ParseContext, ParseResult } from "../types";
import type { NifcRaw } from "./types";

/** Incidents not updated for this long are treated as stale. */
const STALE_MS = 30 * 86_400_000;

const titleCase = (s: string) => (/[a-z]/.test(s) ? s : s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()));

export function parseNifc(raw: NifcRaw, ctx: ParseContext): ParseResult {
  const candidates: EventCandidateInput[] = [];
  let skipped = 0;
  for (const f of raw.features ?? []) {
    const p = f.properties;
    const c = f.geometry?.coordinates;
    const id = p?.IrwinID?.replace(/[{}]/g, "") ?? p?.UniqueFireIdentifier;
    if (!p || !c || !id || !p.FireDiscoveryDateTime || !Number.isFinite(c[0]) || !Number.isFinite(c[1])) {
      skipped++;
      continue;
    }
    const modified = p.ModifiedOnDateTime_dt ?? p.FireDiscoveryDateTime;
    // Fully contained fires drop off once they stop being updated.
    if (ctx.now - modified > STALE_MS || (p.PercentContained === 100 && ctx.now - modified > 3 * 86_400_000)) {
      skipped++;
      continue;
    }
    const name = titleCase((p.IncidentName ?? "Unnamed").replace(/^\d+\s+/, "").trim());
    const state = p.POOState?.replace(/^US-/, "") ?? null;
    const where = [p.POOCity, p.POOCounty ? `${p.POOCounty} County` : null, state].filter(Boolean).join(", ");
    const acres = Math.round(p.IncidentSize ?? 0);
    const contained = p.PercentContained;
    candidates.push({
      type: "FIRE",
      subtype: "wildfire",
      title: `${name} Fire — ${acres.toLocaleString("en-US")} acres${contained !== null ? `, ${contained}% contained` : ""}${state ? ` (${state})` : ""}`,
      summary:
        `The ${name} Fire${where ? ` in ${where}` : ""} has burned about ${acres.toLocaleString("en-US")} acres` +
        `${contained !== null ? ` and is ${contained}% contained` : ""}, according to the U.S. interagency wildfire incident record.` +
        ` Discovered ${new Date(p.FireDiscoveryDateTime).toISOString().slice(0, 10)}.` +
        `${p.TotalIncidentPersonnel ? ` Personnel assigned: ${p.TotalIncidentPersonnel}.` : ""}` +
        `${p.FireCause ? ` Cause: ${p.FireCause.toLowerCase()}.` : ""}`,
      latitude: c[1],
      longitude: c[0],
      // Point of origin, not the fire's current extent.
      geoPrecision: "city",
      locationName: where || null,
      country: "US",
      timestamp: new Date(p.FireDiscoveryDateTime).toISOString(),
      resolvedAt: null,
      metrics: { acres, percent_contained: contained, personnel: p.TotalIncidentPersonnel, cause: p.FireCause },
      entities: [{ type: "ORGANIZATION", name: "National Interagency Fire Center", code: "NIFC" }],
      source: {
        id: `nifc:${id}`,
        dataSourceId: "nifc",
        externalId: id,
        sourceName: "NIFC Wildland Fire Interagency Geospatial Services (WFIGS)",
        sourceUrl: "https://data-nifc.opendata.arcgis.com/datasets/nifc::wfigs-current-interagency-fire-perimeters",
        title: p.IncidentName,
        titleIsDerived: false,
        publishedAt: new Date(modified).toISOString(),
        retrievedAt: ctx.retrievedAt,
        sourceType: "OFFICIAL_AGENCY",
        assertion: "OFFICIAL_PRELIMINARY",
        credibility: { basis: "U.S. interagency wildfire record (federal, state and local fire agencies via IRWIN)" },
      },
      rawData: p,
    });
  }
  return { candidates, skipped };
}
