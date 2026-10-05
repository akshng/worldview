/** Pure geographic helpers, safe for both server and browser. */

const R_KM = 6371.0088;
const toRad = (d: number) => (d * Math.PI) / 180;

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** [west, south, east, north]. `west > east` means the box crosses the antimeridian. */
export type BBox = [number, number, number, number];

export function isValidBBox(b: BBox): boolean {
  const [w, s, e, n] = b;
  return (
    [w, s, e, n].every(Number.isFinite) &&
    w >= -180 && w <= 180 && e >= -180 && e <= 180 &&
    s >= -90 && s <= 90 && n >= -90 && n <= 90 &&
    s <= n
  );
}

export function bboxContains(b: BBox, lat: number, lon: number): boolean {
  const [w, s, e, n] = b;
  if (lat < s || lat > n) return false;
  if (w <= e) return lon >= w && lon <= e;
  // antimeridian crossing
  return lon >= w || lon <= e;
}

/** Normalise longitude into [-180, 180]. */
export function normalizeLon(lon: number): number {
  const x = ((((lon + 180) % 360) + 360) % 360) - 180;
  return x === -180 && lon > 0 ? 180 : x;
}

type Ring = number[][];

/** Ray casting point-in-ring. Coordinates are [lon, lat]. */
export function pointInRing(lon: number, lat: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function pointInPolygon(lon: number, lat: number, polygon: Ring[]): boolean {
  if (!polygon.length || !pointInRing(lon, lat, polygon[0])) return false;
  for (let h = 1; h < polygon.length; h++) if (pointInRing(lon, lat, polygon[h])) return false;
  return true;
}

export type PolygonalGeometry =
  | { type: "Polygon"; coordinates: Ring[] }
  | { type: "MultiPolygon"; coordinates: Ring[][] };

export function pointInGeometry(lon: number, lat: number, g: PolygonalGeometry): boolean {
  if (g.type === "Polygon") return pointInPolygon(lon, lat, g.coordinates);
  return g.coordinates.some((poly) => pointInPolygon(lon, lat, poly));
}

/** Coarse grid cell key, used for spatial bucketing (dedup candidates, fire clustering). */
export function gridKey(lat: number, lon: number, cellDeg: number): string {
  return `${Math.floor(lat / cellDeg)}:${Math.floor(lon / cellDeg)}`;
}

/**
 * Coarse ocean/sea name for points far from land. Approximate basin boxes —
 * used only as a human-readable fallback label, never as authoritative data.
 */
export function oceanName(lat: number, lon: number): string {
  if (lat > 66) return "Arctic Ocean";
  if (lat < -60) return "Southern Ocean";
  if (lat > 30 && lat < 46 && lon > -6 && lon < 36) return "Mediterranean Sea";
  if (lat > 10 && lat < 25 && lon > -90 && lon < -60) return "Caribbean Sea";
  if (lat > 18 && lat < 31 && lon > -98 && lon < -81) return "Gulf of Mexico";
  if (lon >= 20 && lon < 147 && lat < 30 && !(lon > 100 && lat > 0)) return lat >= 0 ? "North Indian Ocean" : "South Indian Ocean";
  if (lon >= -70 && lon < 20) return lat >= 0 ? "North Atlantic Ocean" : "South Atlantic Ocean";
  if (lon >= -100 && lon < -70 && lat > 8) return "North Atlantic Ocean";
  const west = lon >= 100 || lon < -170 ? "Western" : lon >= -170 && lon < -120 ? "Central" : "Eastern";
  return `${lat >= 0 ? "North" : "South"} Pacific Ocean (${west.toLowerCase()})`.replace("(western)", "— west").replace("(central)", "— central").replace("(eastern)", "— east");
}
