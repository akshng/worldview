/**
 * Satellite orbital elements from CelesTrak (keyless GP data, OMM JSON).
 * The server only fetches and caches element sets; browsers propagate
 * positions themselves with the bundled SGP4 (./sgp4), so positions update
 * every few seconds without further requests.
 *
 * CelesTrak updates GP data every ~2 hours and asks clients not to download
 * the same data more often, hence the 2-hour TTL.
 */
import { httpGet } from "@/data-sources/types";
import type { LiveLayerProvider } from "../types";
import { mergeGroups, type CelestrakGp, type SatGroup, type SatellitesData } from "./parser";

export type { SatElements, SatellitesData, SatGroup } from "./parser";

const GP = "https://celestrak.org/NORAD/elements/gp.php";

/** CelesTrak group → our group, with a per-group cap to keep the client light. */
export const SAT_GROUPS: Array<{ group: SatGroup; celestrak: string; cap: number; label: string }> = [
  { group: "stations", celestrak: "stations", cap: 40, label: "Space stations" },
  { group: "gps", celestrak: "gps-ops", cap: 40, label: "GPS (operational)" },
  { group: "visual", celestrak: "visual", cap: 200, label: "Brightest (naked-eye)" },
];

export const satellitesLayer: LiveLayerProvider<SatellitesData> = {
  id: "satellites",
  name: "Satellites (CelesTrak)",
  description: "Space stations, operational GPS and the ~150 brightest satellites: CelesTrak element sets, positions propagated in the browser with SGP4.",
  homepage: "https://celestrak.org/NORAD/elements/",
  attribution: "Orbital elements: CelesTrak (Dr. T.S. Kelso)",
  ttlMs: 2 * 60 * 60_000,
  async load(ctx) {
    const groups = [];
    for (const g of SAT_GROUPS) {
      // Sequential and small: three requests every two hours.
      const res = await httpGet(`${GP}?GROUP=${g.celestrak}&FORMAT=json`, ctx);
      groups.push({ group: g.group, records: (await res.json()) as CelestrakGp[], cap: g.cap });
    }
    const data = mergeGroups(groups);
    if (!data.sats.length) throw new Error("CelesTrak: no element sets returned");
    const newest = Math.max(...data.sats.map((s) => s.epochMs));
    return {
      layerId: "satellites",
      observedAt: new Date(newest).toISOString(),
      retrievedAt: new Date(ctx.now).toISOString(),
      count: data.sats.length,
      data,
      attribution: this.attribution,
      notes: [
        "Positions are computed from published orbital elements (SGP4), not observed.",
        "GPS and other high orbits use a simplified model without lunisolar terms (accurate to tens of km near the element epoch).",
      ],
    };
  },
};
