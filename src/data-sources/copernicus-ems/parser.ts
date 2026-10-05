import type { EventCandidateInput, EventCategory } from "@/types/events";
import type { ParseContext, ParseResult } from "../types";
import type { CemsRaw } from "./types";

const MAX_AGE_MS = 45 * 86_400_000;

export function categoryFor(c: string): { type: EventCategory; subtype: string } {
  const s = c.toLowerCase();
  if (s.includes("flood")) return { type: "FLOOD", subtype: "flood" };
  if (s.includes("fire")) return { type: "FIRE", subtype: "wildfire" };
  if (s.includes("earthquake")) return { type: "EARTHQUAKE", subtype: "earthquake" };
  if (s.includes("volcan")) return { type: "VOLCANO", subtype: "eruption" };
  if (s.includes("storm") || s.includes("wind") || s.includes("cyclone")) return { type: "WEATHER", subtype: "storm" };
  if (s.includes("industrial") || s.includes("technological")) return { type: "INFRASTRUCTURE", subtype: "industrial-accident" };
  return { type: "DISASTER", subtype: s.replace(/[^a-z]+/g, "-").replace(/^-|-$/g, "") || "disaster" };
}

export function parsePointWkt(wkt: string | null): { lat: number; lon: number } | null {
  const m = wkt?.match(/POINT\s*\(\s*(-?[\d.]+)\s+(-?[\d.]+)\s*\)/i);
  if (!m) return null;
  const lon = Number(m[1]), lat = Number(m[2]);
  return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null;
}

/** Copernicus timestamps carry no zone designator; they are UTC. */
const utc = (s: string) => new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s}Z`);

export function parseCems(raw: CemsRaw, ctx: ParseContext): ParseResult {
  const candidates: EventCandidateInput[] = [];
  let skipped = 0;
  for (const a of raw.results ?? []) {
    const pt = parsePointWkt(a.centroid);
    const activated = utc(a.activationTime);
    const happened = a.eventTime ? utc(a.eventTime) : activated;
    if (!pt || Number.isNaN(activated.getTime()) || (a.closed && ctx.now - activated.getTime() > MAX_AGE_MS)) {
      skipped++;
      continue;
    }
    const { type, subtype } = categoryFor(a.category);
    const countries = a.countries?.join(", ") ?? "";
    candidates.push({
      type,
      subtype,
      title: a.name,
      summary:
        `The EU Copernicus Emergency Management Service activated satellite rapid mapping (${a.code}) for "${a.name}"` +
        ` on ${activated.toISOString().slice(0, 10)}. Event reported ${happened.toISOString().slice(0, 16).replace("T", " ")} UTC.` +
        `${a.n_products ? ` ${a.n_products} map product${a.n_products === 1 ? "" : "s"} published.` : ""}` +
        ` Activation status: ${a.closed ? "closed" : "open"}.`,
      latitude: pt.lat,
      longitude: pt.lon,
      // The centroid of the mapped areas of interest, not a precise impact point.
      geoPrecision: "region",
      locationName: countries || null,
      timestamp: happened.toISOString(),
      metrics: { activation: a.code, map_products: a.n_products ?? null, areas_of_interest: a.n_aois ?? null, activation_open: !a.closed },
      entities: [
        { type: "ORGANIZATION", name: "Copernicus EMS", code: null },
        ...(a.countries ?? []).map((name) => ({ type: "COUNTRY" as const, name, code: null })),
      ],
      source: {
        id: `copernicus-ems:${a.code}`,
        dataSourceId: "copernicus-ems",
        externalId: a.code,
        sourceName: "Copernicus Emergency Management Service — Rapid Mapping",
        sourceUrl: `https://rapidmapping.emergency.copernicus.eu/${encodeURIComponent(a.code)}`,
        title: a.name,
        titleIsDerived: false,
        publishedAt: utc(a.lastUpdate ?? a.activationTime).toISOString(),
        retrievedAt: ctx.retrievedAt,
        sourceType: "OFFICIAL_AGENCY",
        assertion: "OFFICIAL_PRELIMINARY",
        credibility: { basis: "European Union Copernicus programme (European Commission JRC)" },
      },
      rawData: a,
    });
  }
  return { candidates, skipped };
}
