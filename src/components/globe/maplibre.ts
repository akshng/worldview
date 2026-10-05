"use client";
import * as maplibregl from "maplibre-gl";

let configured = false;
/** MapLibre v6 worker is served from /public (see scripts/copy-maplibre-worker.mjs). */
export function getMaplibre() {
  if (!configured) {
    maplibregl.setWorkerUrl(`${window.location.origin}/vendor/maplibre/maplibre-gl-worker.mjs`);
    configured = true;
  }
  return maplibregl;
}
