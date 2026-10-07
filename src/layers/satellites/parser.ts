import type { MeanElements } from "./sgp4";

/** CelesTrak GP data in OMM JSON form (subset). https://celestrak.org/NORAD/documentation/gp-data-formats.php */
export interface CelestrakGp {
  OBJECT_NAME?: string;
  OBJECT_ID?: string;
  NORAD_CAT_ID?: number;
  EPOCH?: string;
  MEAN_MOTION?: number;
  ECCENTRICITY?: number;
  INCLINATION?: number;
  RA_OF_ASC_NODE?: number;
  ARG_OF_PERICENTER?: number;
  MEAN_ANOMALY?: number;
  BSTAR?: number;
}

export type SatGroup = "stations" | "gps" | "visual";

export interface SatElements extends MeanElements {
  id: number;
  name: string;
  intlDes: string;
  group: SatGroup;
}

export interface SatellitesData {
  sats: SatElements[];
  /** per-group counts after de-duplication and caps */
  groups: Record<SatGroup, number>;
}

const fin = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** OMM epochs are UTC without a zone and may carry microseconds. */
export function parseOmmEpoch(s: string | undefined): number | null {
  const m = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(\.\d+)?Z?$/.exec(s?.trim() ?? "");
  if (!m) return null;
  const base = Date.parse(`${m[1]}Z`);
  return Number.isFinite(base) ? base + (m[2] ? Math.round(Number(m[2]) * 1000) : 0) : null;
}

/** Convert one GP record to elements, or null if any element is missing / non-physical. */
export function parseGp(r: CelestrakGp, group: SatGroup): SatElements | null {
  const epochMs = parseOmmEpoch(r?.EPOCH);
  if (
    epochMs === null ||
    !fin(r.NORAD_CAT_ID) ||
    !fin(r.MEAN_MOTION) ||
    r.MEAN_MOTION <= 0 ||
    !fin(r.ECCENTRICITY) ||
    r.ECCENTRICITY < 0 ||
    r.ECCENTRICITY >= 1 ||
    !fin(r.INCLINATION) ||
    !fin(r.RA_OF_ASC_NODE) ||
    !fin(r.ARG_OF_PERICENTER) ||
    !fin(r.MEAN_ANOMALY)
  )
    return null;
  return {
    id: r.NORAD_CAT_ID,
    name: (r.OBJECT_NAME ?? "").replace(/\s+/g, " ").trim() || `NORAD ${r.NORAD_CAT_ID}`,
    intlDes: r.OBJECT_ID ?? "",
    group,
    epochMs,
    meanMotion: r.MEAN_MOTION,
    eccentricity: r.ECCENTRICITY,
    inclination: r.INCLINATION,
    raan: r.RA_OF_ASC_NODE,
    argOfPericenter: r.ARG_OF_PERICENTER,
    meanAnomaly: r.MEAN_ANOMALY,
    bstar: fin(r.BSTAR) ? r.BSTAR : 0,
  };
}

/**
 * Merge groups in priority order, dropping duplicate NORAD ids and objects
 * sharing identical elements (e.g. ISS modules all carry the ISS orbit), and
 * capping each group.
 */
export function mergeGroups(groups: Array<{ group: SatGroup; records: CelestrakGp[]; cap: number }>): SatellitesData {
  const seenId = new Set<number>();
  const seenOrbit = new Set<string>();
  const sats: SatElements[] = [];
  const counts: Record<SatGroup, number> = { stations: 0, gps: 0, visual: 0 };
  for (const { group, records, cap } of groups) {
    for (const r of Array.isArray(records) ? records : []) {
      if (counts[group] >= cap) break;
      const s = parseGp(r, group);
      if (!s || seenId.has(s.id)) continue;
      const orbitKey = `${s.epochMs}|${s.meanMotion}|${s.meanAnomaly}|${s.raan}`;
      if (seenOrbit.has(orbitKey)) continue;
      seenId.add(s.id);
      seenOrbit.add(orbitKey);
      sats.push(s);
      counts[group]++;
    }
  }
  return { sats, groups: counts };
}
