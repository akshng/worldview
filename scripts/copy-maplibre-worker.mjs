// MapLibre v6 loads its web worker as a separate ES module. Bundlers rewrite
// import.meta.url, so we serve the worker files from /public and point
// maplibregl.setWorkerUrl() at them (see src/components/globe/maplibre.ts).
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const dist = path.dirname(require.resolve("maplibre-gl/package.json")) + "/dist";
const out = path.resolve("public/vendor/maplibre");
mkdirSync(out, { recursive: true });
for (const f of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) copyFileSync(path.join(dist, f), path.join(out, f));
console.log("[maplibre] worker copied to public/vendor/maplibre");
