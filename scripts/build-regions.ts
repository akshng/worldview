/**
 * Build public/geo/regions.geojson: simplified first-level administrative regions
 * (states, provinces, prefectures…) for every country, from Natural Earth 10m
 * admin-1 (public domain). Loaded by the browser only when the map is zoomed in.
 *
 *   npm run geo:regions
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { simplifyRing } from "../src/lib/geo/math";

type Pt = [number, number];
type Ring = Pt[];
const URL = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_1_states_provinces.geojson";
const TOLERANCE = 0.02; // degrees (~2 km)

/** Shoelace area in square degrees (for dropping specks). */
const ringArea = (r: Ring) => Math.abs(r.reduce((s, [x1, y1], i) => { const [x2, y2] = r[(i + 1) % r.length]; return s + x1 * y2 - x2 * y1; }, 0) / 2);

function simplifyPolygon(poly: Ring[]): Ring[] | null {
  const outer = simplifyRing(poly[0], TOLERANCE, 600);
  if (outer.length < 4) return null;
  // Keep holes only if they're large enough to see.
  const holes = poly.slice(1).filter((h) => ringArea(h) > 0.05).map((h) => simplifyRing(h, TOLERANCE, 200)).filter((h) => h.length >= 4);
  return [outer, ...holes];
}

async function main() {
  console.log("downloading Natural Earth admin-1 …");
  const raw = (await (await fetch(URL)).json()) as { features: Array<{ properties: Record<string, unknown>; geometry: { type: string; coordinates: unknown } | null }> };
  const features = [];
  for (const f of raw.features) {
    const p = f.properties;
    const iso2 = String(p.iso_a2 ?? "");
    if (!f.geometry || !iso2 || iso2 === "-99") continue;
    let polys: Ring[][] = f.geometry.type === "Polygon" ? [f.geometry.coordinates as Ring[]] : f.geometry.type === "MultiPolygon" ? (f.geometry.coordinates as Ring[][]) : [];
    // Drop tiny islands relative to the region's largest part.
    const biggest = Math.max(...polys.map((pl) => ringArea(pl[0])));
    polys = polys.filter((pl) => ringArea(pl[0]) >= Math.min(0.01, biggest * 0.02));
    const simplified = polys.map(simplifyPolygon).filter((x): x is Ring[] => !!x);
    if (!simplified.length) continue;
    features.push({
      type: "Feature",
      id: features.length + 1,
      properties: {
        name: String(p.name_en ?? p.name ?? ""),
        type: (p.type_en as string | null) ?? null,
        country: iso2,
        countryName: String(p.admin ?? ""),
      },
      geometry: simplified.length === 1 ? { type: "Polygon", coordinates: simplified[0] } : { type: "MultiPolygon", coordinates: simplified },
    });
  }
  const out = path.join(process.cwd(), "public", "geo", "regions.geojson");
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify({ type: "FeatureCollection", features }));
  console.log(`wrote ${features.length} regions to ${out}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
