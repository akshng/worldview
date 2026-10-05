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

// ---------------------------------------------------------------------------
// Polygon helpers (lon/lat, small areas — planar approximations are fine)
// ---------------------------------------------------------------------------
type Pt = [number, number];

/** Signed-area centroid of a ring (falls back to vertex mean for degenerate rings). */
export function ringCentroid(ring: Pt[]): Pt {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const f = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    a += f;
    cx += (ring[j][0] + ring[i][0]) * f;
    cy += (ring[j][1] + ring[i][1]) * f;
  }
  if (Math.abs(a) < 1e-12) {
    const n = ring.length || 1;
    return [ring.reduce((s, p) => s + p[0], 0) / n, ring.reduce((s, p) => s + p[1], 0) / n];
  }
  return [cx / (3 * a), cy / (3 * a)];
}

function segDist(px: number, py: number, a: Pt, b: Pt): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const t = dx || dy ? Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / (dx * dx + dy * dy))) : 0;
  return Math.hypot(px - (a[0] + t * dx), py - (a[1] + t * dy));
}

/**
 * A point guaranteed to lie inside the polygon, far from its edges (a light
 * "pole of inaccessibility" search). Used so representative points never fall
 * outside concave warning areas.
 */
export function interiorPoint(polygon: Pt[][]): Pt {
  const outer = polygon[0];
  const c = ringCentroid(outer);
  const inside = (x: number, y: number) => pointInPolygon(x, y, polygon);
  const edgeDist = (x: number, y: number) => {
    let d = Infinity;
    for (const r of polygon) for (let i = 0, j = r.length - 1; i < r.length; j = i++) d = Math.min(d, segDist(x, y, r[j], r[i]));
    return d;
  };
  let best: Pt | null = inside(c[0], c[1]) ? c : null;
  let bestD = best ? edgeDist(c[0], c[1]) : -1;
  let [w, s, e, n] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of outer) {
    w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y);
  }
  const N = 24;
  for (let i = 0; i <= N; i++)
    for (let j = 0; j <= N; j++) {
      const x = w + ((e - w) * i) / N, y = s + ((n - s) * j) / N;
      if (!inside(x, y)) continue;
      const d = edgeDist(x, y);
      // Prefer the centroid unless a clearly better interior point exists.
      if (d > bestD * 1.5) {
        best = [x, y];
        bestD = d;
      }
    }
  return best ?? outer[0];
}

/** Largest polygon (by bbox area) of a Polygon/MultiPolygon, for picking a representative point. */
export function mainPolygon(g: { type: "Polygon"; coordinates: Pt[][] } | { type: "MultiPolygon"; coordinates: Pt[][][] }): Pt[][] {
  if (g.type === "Polygon") return g.coordinates;
  let best = g.coordinates[0], bestA = -1;
  for (const poly of g.coordinates) {
    const xs = poly[0].map((p) => p[0]), ys = poly[0].map((p) => p[1]);
    const a = (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
    if (a > bestA) {
      bestA = a;
      best = poly;
    }
  }
  return best;
}

/** Douglas–Peucker simplification, keeping rings closed and valid. */
export function simplifyRing(ring: Pt[], tolerance: number, maxPoints = 120): Pt[] {
  if (ring.length <= 5) return ring;
  const keep = new Uint8Array(ring.length);
  keep[0] = keep[ring.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, ring.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let idx = -1, dmax = 0;
    for (let i = a + 1; i < b; i++) {
      const d = segDist(ring[i][0], ring[i][1], ring[a], ring[b]);
      if (d > dmax) {
        dmax = d;
        idx = i;
      }
    }
    if (idx > 0 && dmax > tolerance) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  let out = ring.filter((_, i) => keep[i]).map(([x, y]) => [Math.round(x * 1e4) / 1e4 + 0, Math.round(y * 1e4) / 1e4 + 0] as Pt);
  if (out.length < 4) out = ring.slice(0, 4);
  out[out.length - 1] = out[0]; // keep the ring exactly closed
  if (out.length > maxPoints) return simplifyRing(ring, tolerance * 2, maxPoints);
  return out;
}

/** Convex hull (monotone chain), closed ring. Returns null for < 3 distinct points. */
export function convexHull(points: Pt[]): Pt[] | null {
  const pts = [...new Map(points.map((p) => [`${p[0]},${p[1]}`, p])).values()].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return null;
  const cross = (o: Pt, a: Pt, b: Pt) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Pt[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Pt[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  const hull = [...lower.slice(0, -1), ...upper.slice(0, -1)];
  if (hull.length < 3) return null;
  return [...hull, hull[0]];
}

/** Square ring of half-size `d` degrees around a point (for tiny/degenerate areas). */
export function boxRing(lon: number, lat: number, d: number): Pt[] {
  return [[lon - d, lat - d], [lon + d, lat - d], [lon + d, lat + d], [lon - d, lat + d], [lon - d, lat - d]];
}
