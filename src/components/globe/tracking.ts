/**
 * GeoJSON builders for the live-tracking overlays (ships, military aircraft,
 * satellites). Pure functions — no map or React — so they are unit-testable.
 */
import { shipCategory } from "@/layers/maritime/parser";
import type { MaritimeData } from "@/layers/maritime/types";
import type { MilitaryAircraftData } from "@/layers/military-aircraft/parser";
import type { AircraftData } from "@/layers/aircraft/parser";
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

/** Civil (and other) aircraft from adsb.lol; military-flagged ones can be left to the MIL overlay. */
export function aircraftFeatures(data: AircraftData, skipMil = false): FC {
  const features: GeoJSON.Feature[] = [];
  for (const [hex, callsign, reg, type, lon, lat, alt, onGround, gs, track, squawk, age, mil] of data.rows) {
    if (skipMil && mil) continue;
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [lon, lat] },
      properties: { hex, callsign, reg, type, alt, onGround, gs, track, squawk, age, mil, label: callsign || reg || hex },
    });
  }
  return { type: "FeatureCollection", features };
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

const MU_KM3_S2 = 398600.4418;
const EARTH_R_KM = 6378.137;

/** Orbit shape from mean elements: period, semi-major axis, apogee / perigee altitude. */
export function orbitInfo(el: { meanMotion: number; eccentricity: number; inclination: number }) {
  const n = (el.meanMotion * 2 * Math.PI) / 86_400; // rad/s
  const a = Math.cbrt(MU_KM3_S2 / (n * n));
  return {
    periodMin: 1440 / el.meanMotion,
    semiMajorKm: a,
    apogeeKm: a * (1 + el.eccentricity) - EARTH_R_KM,
    perigeeKm: a * (1 - el.eccentricity) - EARTH_R_KM,
    inclinationDeg: el.inclination,
  };
}

export interface TrackRefLike {
  kind: "ship" | "aircraft" | "sat";
  id: string;
  mil?: boolean;
}

/** Current position (and heading) of a tracked object in the loaded data, or null. */
export function trackPosition(
  ref: TrackRefLike,
  d: { ships: MaritimeData | null; aircraft: AircraftData | null; mil: MilitaryAircraftData | null; sats: PreparedSat[] },
  ms = Date.now(),
): { lon: number; lat: number; heading: number | null } | null {
  if (ref.kind === "ship") {
    const r = d.ships?.rows.find((x) => String(x[0]) === ref.id);
    return r ? { lon: r[2], lat: r[3], heading: r[6] ?? r[5] } : null;
  }
  if (ref.kind === "aircraft") {
    const r = (ref.mil ? d.mil?.rows.find((x) => x[0] === ref.id) : null) ?? d.aircraft?.rows.find((x) => x[0] === ref.id) ?? d.mil?.rows.find((x) => x[0] === ref.id);
    return r ? { lon: r[4], lat: r[5], heading: r[9] } : null;
  }
  const sat = d.sats.find((x) => String(x.el.id) === ref.id);
  const p = sat ? subPoint(sat.rec, ms) : null;
  return p ? { lon: p.lon, lat: p.lat, heading: null } : null;
}

/** Highlight rings for the selected and hovered objects plus the selected one's recent trail. */
export function highlightFeatures(
  selected: { lon: number; lat: number } | null,
  hovered: { lon: number; lat: number } | null,
  trail: Array<[number, number, number]>,
): FC {
  const features: GeoJSON.Feature[] = [];
  if (selected && trail.length) {
    const coords = trail.map((p) => [p[0], p[1]] as [number, number]);
    const last = coords[coords.length - 1];
    if (!last || last[0] !== selected.lon || last[1] !== selected.lat) coords.push([selected.lon, selected.lat]);
    for (const line of splitAntimeridian(coords)) if (line.length > 1) features.push({ type: "Feature", geometry: { type: "LineString", coordinates: line }, properties: { role: "trail" } });
  }
  if (hovered) features.push({ type: "Feature", geometry: { type: "Point", coordinates: [hovered.lon, hovered.lat] }, properties: { role: "hover" } });
  if (selected) features.push({ type: "Feature", geometry: { type: "Point", coordinates: [selected.lon, selected.lat] }, properties: { role: "selected" } });
  return { type: "FeatureCollection", features };
}
