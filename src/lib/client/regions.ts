"use client";
/** First-level administrative regions (states/provinces), loaded once on first zoom-in. */
import type { AreaGeometry } from "@/types/events";

export interface RegionProps {
  name: string;
  type: string | null;
  country: string;
  countryName: string;
}
export type RegionFeature = { type: "Feature"; id: number; properties: RegionProps; geometry: AreaGeometry };
export type RegionCollection = { type: "FeatureCollection"; features: RegionFeature[] };

/** Zoom at which the map switches from countries to states/provinces. */
export const REGION_ZOOM = 3.2;

let pending: Promise<RegionCollection> | null = null;
let byId: Map<number, RegionFeature> | null = null;

export function loadRegions(): Promise<RegionCollection> {
  pending ??= fetch("/geo/regions.geojson")
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
    .then((fc: RegionCollection) => {
      byId = new Map(fc.features.map((f) => [f.id, f]));
      return fc;
    })
    .catch((err) => {
      pending = null;
      throw err;
    });
  return pending;
}

export function regionById(id: number): RegionFeature | undefined {
  return byId?.get(id);
}

export function bboxOfGeometry(g: AreaGeometry): [number, number, number, number] {
  let w = 180, s = 90, e = -180, n = -90;
  const polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
  for (const poly of polys) for (const [x, y] of poly[0]) {
    if (x < w) w = x;
    if (x > e) e = x;
    if (y < s) s = y;
    if (y > n) n = y;
  }
  return [w, s, e, n];
}
