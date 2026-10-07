/**
 * GeoJSON builders for the live-tracking overlays (ships, military aircraft,
 * satellites). Pure functions — no map or React — so they are unit-testable.
 */
import { shipCategory } from "@/layers/maritime/parser";
import type { MaritimeData } from "@/layers/maritime/types";
import type { MilitaryAircraftData } from "@/layers/military-aircraft/parser";
import type { SatElements } from "@/layers/satellites/parser";
import { groundTrack, sgp4init, subPoint, type SatRec } from "@/layers/satellites/sgp4";
import { splitAntimeridian } from "@/layers/iss";

type FC = GeoJSON.FeatureCollection;

export function vesselFeatures(data: MaritimeData): FC {
  return {
    type: "FeatureCollection",
    features: data.rows.map(([mmsi, name, lon, lat, sog, cog, heading, nav, , type, dest]) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [lon, lat] },
      properties: { mmsi, name, sog, cog, heading: heading ?? cog, nav, type, dest, cat: shipCategory(type) },
    })),
  };
}

export function milFeatures(data: MilitaryAircraftData): FC {
  return {
    type: "FeatureCollection",
    features: data.rows.map(([hex, callsign, reg, type, lon, lat, alt, onGround, gs, track, squawk, age]) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [lon, lat] },
      properties: { hex, callsign, reg, type, alt, onGround, gs, track, squawk, age, label: callsign || reg || hex },
    })),
  };
}

export interface PreparedSat {
  el: SatElements;
  rec: SatRec;
}

/** Initialise SGP4 records once per element set, skipping any that fail. */
export function prepareSats(sats: SatElements[]): PreparedSat[] {
  const out: PreparedSat[] = [];
  for (const el of sats) {
    try {
      out.push({ el, rec: sgp4init(el) });
    } catch {
      /* non-physical element set */
    }
  }
  return out;
}

/** Current sub-satellite points. */
export function satFeatures(sats: PreparedSat[], ms: number, selectedId: number | null): FC {
  const features: GeoJSON.Feature[] = [];
  for (const { el, rec } of sats) {
    const p = subPoint(rec, ms);
    if (!p) continue;
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [p.lon, p.lat] },
      properties: {
        id: el.id,
        name: el.name,
        group: el.group,
        altKm: Math.round(p.altKm),
        speedKms: Math.round(p.speedKms * 100) / 100,
        periodMin: Math.round(rec.periodMin),
        epochMs: el.epochMs,
        selected: el.id === selectedId,
      },
    });
  }
  return { type: "FeatureCollection", features };
}

/**
 * Ground track for one satellite: the past half orbit and the next full orbit,
 * ~180 samples per orbit, split at the antimeridian.
 */
export function satTrackFeatures(sat: PreparedSat, ms: number, color: string): FC {
  const periodMs = sat.rec.periodMin * 60_000;
  const step = Math.max(10_000, periodMs / 180);
  const features: GeoJSON.Feature[] = [];
  for (const [part, from, to] of [
    ["past", ms - periodMs / 2, ms],
    ["future", ms, ms + periodMs],
  ] as const) {
    const lines = splitAntimeridian(groundTrack(sat.rec, from, to, step));
    if (lines.length) features.push({ type: "Feature", geometry: { type: "MultiLineString", coordinates: lines }, properties: { part, color } });
  }
  return { type: "FeatureCollection", features };
}
