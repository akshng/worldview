/**
 * Build public/geo/infra/*.geojson: strategic-infrastructure layers from free,
 * keyless, openly licensed datasets (see docs/DATA_SOURCES.md):
 *
 *   - WRI Global Power Plant Database (CC BY 4.0)        → power-plants
 *   - NGA World Port Index (public domain)                → ports (+ LNG ports)
 *   - OpenStreetMap via Overpass (ODbL)                   → cables, landing-points,
 *                                                           pipelines, lng, datacenters, bases
 *
 * Maritime chokepoints are a curated list in src/lib/infra/chokepoints.ts.
 *
 *   npm run geo:infra            # everything
 *   npm run geo:infra -- ports   # only some layers
 */
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pointInGeometry, type PolygonalGeometry } from "../src/lib/geo/math";
import type { InfraMeta } from "../src/lib/infra/catalog";
import {
  baseProps,
  cableFeatures,
  dataCentreProps,
  landingPointFeatures,
  lngFeatures,
  osmPointFeatures,
  pipelineFeatures,
  portFeatures,
  powerPlantFeatures,
  type OsmElement,
} from "../src/lib/infra/parsers";

const OUT = path.join(process.cwd(), "public", "geo", "infra");
const GPPD = "https://raw.githubusercontent.com/wri/global-power-plant-database/master/output_database/global_power_plant_database.csv";
const WPI = "https://msi.nga.mil/api/publications/download?key=16920959/SFH00000/UpdatedPub150.csv&type=download";
const OVERPASS = ["https://overpass-api.de/api/interpreter", "https://maps.mail.ru/osm/tools/overpass/api/interpreter", "https://overpass.private.coffee/api/interpreter"];
const UA = "WorldView-infra-build/1.0 (+https://github.com/akshng/worldview)";

async function text(url: string): Promise<string> {
  const r = await fetch(url, { headers: { "User-Agent": UA } });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.text();
}

async function overpass(query: string): Promise<OsmElement[]> {
  let last = "";
  for (let attempt = 0; attempt < 6; attempt++) {
    const ep = OVERPASS[attempt % OVERPASS.length];
    try {
      const r = await fetch(ep, {
        method: "POST",
        headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded" },
        body: "data=" + encodeURIComponent(`[out:json][timeout:600];${query}`),
      });
      const t = await r.text();
      if (r.ok && t.startsWith("{")) {
        const j = JSON.parse(t) as { elements: OsmElement[]; remark?: string };
        if (!j.remark?.includes("error")) return j.elements;
        last = j.remark;
      } else last = `HTTP ${r.status}`;
    } catch (err) {
      last = String(err);
    }
    console.log(`  overpass retry (${ep}): ${last.slice(0, 120)}`);
    await new Promise((res) => setTimeout(res, 15_000));
  }
  throw new Error(`Overpass failed: ${last}`);
}

function write(file: string, features: unknown[], meta: InfraMeta) {
  const p = path.join(OUT, `${file}.geojson`);
  // Null/false properties are dropped to keep files small (readers treat missing as null/false).
  writeFileSync(p, JSON.stringify({ type: "FeatureCollection", features }, (_k, v: unknown) => (v === null || v === false ? undefined : v)));
  const bytes = statSync(p).size;
  meta.layers[file] = { count: features.length, bytes };
  console.log(`  ${file}: ${features.length} features, ${(bytes / 1024).toFixed(0)} KB`);
}

/** Country polygons (already bundled) for "is this cable end on the coast?". */
function landTest(): (lon: number, lat: number) => boolean {
  const fc = JSON.parse(readFileSync(path.join(process.cwd(), "public", "geo", "countries.geojson"), "utf8")) as {
    features: Array<{ geometry: PolygonalGeometry }>;
  };
  const geoms = fc.features
    .map((f) => f.geometry)
    .filter(Boolean)
    .map((g) => {
      const pts = (g.type === "Polygon" ? [g.coordinates] : g.coordinates).flatMap((poly) => poly[0]);
      const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
      return { g, box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] };
    });
  const inLand = (lon: number, lat: number) =>
    geoms.some(({ g, box }) => lon >= box[0] && lon <= box[2] && lat >= box[1] && lat <= box[3] && pointInGeometry(lon, lat, g));
  // ~6 km tolerance: the bundled coastline is simplified.
  const d = 0.055;
  const offsets = [[0, 0], [d, 0], [-d, 0], [0, d], [0, -d], [d, d], [-d, -d], [d, -d], [-d, d]];
  return (lon, lat) => offsets.some(([x, y]) => inLand(lon + x, lat + y));
}

async function main() {
  const only = new Set(process.argv.slice(2));
  const want = (k: string) => !only.size || only.has(k);
  mkdirSync(OUT, { recursive: true });
  const metaPath = path.join(OUT, "meta.json");
  let meta: InfraMeta = { builtAt: "", layers: {} };
  try {
    meta = JSON.parse(readFileSync(metaPath, "utf8")) as InfraMeta;
  } catch {}

  if (want("power-plants")) {
    console.log("WRI Global Power Plant Database …");
    write("power-plants", powerPlantFeatures(await text(GPPD), 30), meta);
  }

  let ports: ReturnType<typeof portFeatures> | null = null;
  if (want("ports") || want("lng")) {
    console.log("NGA World Port Index …");
    ports = portFeatures(await text(WPI));
    if (want("ports")) write("ports", ports, meta);
  }

  if (want("cables") || want("landing-points")) {
    console.log("OSM submarine telecom cables …");
    const els = await overpass(
      `(way["communication"="line"]["location"~"underwater|submarine"];way["communication"="line"]["submarine"="yes"];` +
        `way["telecom"="cable"]["location"~"underwater|submarine"];way["seamark:type"="cable_submarine"]["seamark:cable_submarine:category"~"tele|fib|opt|communication",i];);out geom;`,
    );
    const cables = cableFeatures(els, 0.01, 1);
    if (want("cables")) write("cables", cables, meta);
    console.log("OSM cable landing stations …");
    const stations = await overpass(`(nwr["telecom"~"landing"];nwr["building"="cable_landing_station"];nwr["name"~"[Cc]able [Ll]anding"];);out center tags;`);
    write("landing-points", landingPointFeatures(cables, stations, landTest(), 5), meta);
  }

  if (want("pipelines")) {
    console.log("OSM pipeline route relations …");
    write("pipelines", pipelineFeatures(await overpass(`relation["type"="route"]["route"="pipeline"];out geom;`), 0.02, 10), meta);
  }

  if (want("lng")) {
    console.log("OSM LNG terminals …");
    const els = await overpass(
      `(nwr["industrial"="lng_terminal"];nwr["landuse"="industrial"]["name"~"LNG"];nwr["man_made"="storage_tank"]["content"~"^lng$",i];);out center tags;`,
    );
    write("lng", lngFeatures(els, ports ?? []), meta);
  }

  if (want("datacenters")) {
    console.log("OSM data centres …");
    write("datacenters", osmPointFeatures(await overpass(`nwr["telecom"="data_center"];out center tags;`), dataCentreProps, 0.3), meta);
  }

  if (want("bases")) {
    console.log("OSM military bases …");
    write("bases", osmPointFeatures(await overpass(`nwr["military"~"^(base|naval_base)$"];out center tags;`), baseProps, 1), meta);
  }

  meta.builtAt = new Date().toISOString();
  writeFileSync(metaPath, JSON.stringify(meta, null, 1));
  const total = Object.values(meta.layers).reduce((s, l) => s + l.bytes, 0);
  console.log(`done — ${(total / 1024 / 1024).toFixed(2)} MB in ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
