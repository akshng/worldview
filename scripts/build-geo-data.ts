/**
 * Builds the bundled geographic reference data from Natural Earth (public domain).
 *
 *   npx tsx scripts/build-geo-data.ts
 *
 * Outputs (committed to the repo so the app works offline):
 *   src/data/geo/countries.json   – compact country polygons + metadata (server: reverse geocoding, search)
 *   src/data/geo/cities.json      – populated places (server: nearest-place labels, search)
 *   public/geo/countries.geojson  – same polygons for the globe's country hover/click layer
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const NE = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson";
const COUNTRIES_URL = `${NE}/ne_50m_admin_0_countries.geojson`;
const PLACES_URL = `${NE}/ne_50m_populated_places_simple.geojson`;

const MIDDLE_EAST = new Set([
  "SA", "AE", "QA", "KW", "BH", "OM", "YE", "IR", "IQ", "SY", "LB", "JO", "IL", "PS", "TR", "CY", "EG",
]);

type Pos = number[];
type Geometry = { type: "Polygon"; coordinates: Pos[][] } | { type: "MultiPolygon"; coordinates: Pos[][][] };

function round(n: number, d = 3) {
  const f = 10 ** d;
  return Math.round(n * f) / f;
}

function roundRing(ring: Pos[]): Pos[] {
  const out: Pos[] = [];
  for (const [x, y] of ring) {
    const p = [round(x), round(y)];
    const last = out[out.length - 1];
    if (!last || last[0] !== p[0] || last[1] !== p[1]) out.push(p);
  }
  return out;
}

function roundGeometry(g: Geometry): Geometry {
  if (g.type === "Polygon") return { type: "Polygon", coordinates: g.coordinates.map(roundRing) };
  return { type: "MultiPolygon", coordinates: g.coordinates.map((poly) => poly.map(roundRing)) };
}

function bboxOf(g: Geometry): [number, number, number, number] {
  let minX = 180, minY = 90, maxX = -180, maxY = -90;
  const rings = g.type === "Polygon" ? g.coordinates : g.coordinates.flat();
  for (const ring of rings)
    for (const [x, y] of ring) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  return [minX, minY, maxX, maxY];
}

function macroRegion(iso2: string, continent: string, subregion: string): string {
  if (MIDDLE_EAST.has(iso2)) return "Middle East";
  if (continent === "North America") {
    return subregion === "Northern America" ? "North America" : "Latin America";
  }
  if (continent === "South America") return "Latin America";
  if (continent === "Seven seas (open ocean)") return "Oceans";
  return continent; // Europe, Africa, Asia, Oceania, Antarctica
}

async function main() {
  const root = process.cwd();
  const [countriesRaw, placesRaw] = await Promise.all([
    fetch(COUNTRIES_URL).then((r) => r.json()),
    fetch(PLACES_URL).then((r) => r.json()),
  ]);

  const countries = [];
  const publicFeatures = [];
  for (const f of countriesRaw.features) {
    const p = f.properties;
    const iso2: string = p.ISO_A2_EH !== "-99" ? p.ISO_A2_EH : p.ISO_A2;
    const iso3: string = p.ISO_A3_EH !== "-99" ? p.ISO_A3_EH : p.ADM0_A3;
    // Disputed/unrecognised areas without an ISO code get a stable synthetic code from ADM0_A3.
    const code = iso2 && iso2 !== "-99" ? iso2 : `X-${p.ADM0_A3}`;
    const geometry = roundGeometry(f.geometry);
    const entry = {
      code,
      iso3,
      name: p.NAME as string,
      nameLong: p.NAME_LONG as string,
      continent: p.CONTINENT as string,
      subregion: p.SUBREGION as string,
      region: macroRegion(code, p.CONTINENT, p.SUBREGION),
      population: p.POP_EST as number,
      label: [round(p.LABEL_X, 3), round(p.LABEL_Y, 3)] as [number, number],
      bbox: bboxOf(geometry).map((n) => round(n, 3)),
      geometry,
    };
    countries.push(entry);
    publicFeatures.push({
      type: "Feature",
      id: publicFeatures.length + 1,
      properties: { code, name: entry.name },
      geometry,
    });
  }

  const cities = placesRaw.features.map((f: { properties: Record<string, unknown> }) => {
    const p = f.properties as Record<string, string | number>;
    return {
      name: p.name,
      country: p.iso_a2 === "-99" ? null : p.iso_a2,
      countryName: p.adm0name,
      admin1: p.adm1name ?? null,
      lat: round(Number(p.latitude), 4),
      lon: round(Number(p.longitude), 4),
      population: Number(p.pop_max) || 0,
      capital: Number(p.adm0cap) === 1,
    };
  });

  mkdirSync(join(root, "src/data/geo"), { recursive: true });
  mkdirSync(join(root, "public/geo"), { recursive: true });
  writeFileSync(join(root, "src/data/geo/countries.json"), JSON.stringify(countries));
  writeFileSync(join(root, "src/data/geo/cities.json"), JSON.stringify(cities));
  writeFileSync(
    join(root, "public/geo/countries.geojson"),
    JSON.stringify({ type: "FeatureCollection", features: publicFeatures }),
  );
  console.log(`countries: ${countries.length}, cities: ${cities.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
