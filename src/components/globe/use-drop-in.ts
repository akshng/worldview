"use client";
/**
 * Map side of the street-level "drop in" view: terrain, 3D buildings and the
 * horizon sky exist only while dropped in (they are heavy on the GPU and battery),
 * and are torn down once the camera has flown back out to the globe.
 */
import { useEffect, useRef } from "react";
import type { Map as MlMap, SkySpecification } from "maplibre-gl";
import { useUI, type MapStyleId } from "@/lib/store/ui";
import { BUILDINGS_LAYER, DROPIN_LIGHT, DROPIN_SKY, HILLSHADE_LAYER, HILLSHADE_SOURCE, IMAGERY_TOP, TERRAIN_EXAGGERATION, TERRAIN_SOURCE, buildingsLayer, hillshadeLayer, hillshadeSource, terrainSource } from "./style";
import {
  DROP_DURATION_MS,
  DROP_MAX_PITCH,
  EXIT_DURATION_MS,
  GLOBE_MAX_PITCH,
  dropInCamera,
  normalizeBearing,
  type CameraView,
} from "@/components/dropin/logic";

/** Buildings go under the event / mode layers so markers stay on top and clickable. */
const BUILDINGS_BEFORE = ["area-fill", "density-fill", "ev-heat"];

/** Sky that blends from the space-black globe backdrop to a hazy daylight horizon as the camera descends. */
function dropInSky(globeSky: SkySpecification | undefined): SkySpecification {
  const z = (lo: string, hi: string) => ["interpolate", ["linear"], ["zoom"], 8, lo, 12, hi] as unknown as string;
  return {
    ...(globeSky ?? {}),
    "sky-color": z(String(globeSky?.["sky-color"] ?? "#05070a"), DROPIN_SKY["sky-color"]),
    "horizon-color": z(String(globeSky?.["horizon-color"] ?? "#0f2236"), DROPIN_SKY["horizon-color"]),
    "fog-color": z(String(globeSky?.["fog-color"] ?? "#05070a"), DROPIN_SKY["fog-color"]),
    "sky-horizon-blend": DROPIN_SKY["sky-horizon-blend"],
    "horizon-fog-blend": DROPIN_SKY["horizon-fog-blend"],
    "fog-ground-blend": DROPIN_SKY["fog-ground-blend"],
  };
}

/**
 * MapLibre sizes its feature-query padding by the perspective scale at the top-left screen
 * corner. Above ~70° pitch that corner is sky, the factor comes out negative and every
 * circle/symbol-sized marker silently stops being hit-testable (clicks and hover popups miss
 * them). Clamp it on the transform prototypes so markers stay clickable while dropped in.
 */
const SKY_PITCH_SCALE = 8;
const patchedProtos = new WeakSet<object>();
function fixHighPitchQueries(map: MlMap) {
  type T = { maxPitchScaleFactor?: () => number; _mercatorTransform?: T };
  const m = map as unknown as { _camera?: { transform?: T }; transform?: T };
  const t = m._camera?.transform ?? m.transform;
  for (const obj of [t, t?._mercatorTransform]) {
    const proto = obj ? (Object.getPrototypeOf(obj) as T | null) : null;
    if (!proto || patchedProtos.has(proto) || typeof proto.maxPitchScaleFactor !== "function") continue;
    const orig = proto.maxPitchScaleFactor;
    proto.maxPitchScaleFactor = function (this: T) {
      const f = orig.call(this);
      return Number.isFinite(f) && f >= 1 ? f : SKY_PITCH_SCALE;
    };
    patchedProtos.add(proto);
  }
}

function enable3d(map: MlMap): SkySpecification | undefined {
  fixHighPitchQueries(map);
  map.setMaxPitch(DROP_MAX_PITCH);
  if (!map.getSource(TERRAIN_SOURCE)) map.addSource(TERRAIN_SOURCE, terrainSource());
  map.setTerrain({ source: TERRAIN_SOURCE, exaggeration: TERRAIN_EXAGGERATION });
  if (!map.getLayer(BUILDINGS_LAYER)) map.addLayer(buildingsLayer(), BUILDINGS_BEFORE.find((id) => map.getLayer(id)));
  // Relief shading on top of the imagery (below labels and data).
  if (!map.getSource(HILLSHADE_SOURCE)) map.addSource(HILLSHADE_SOURCE, hillshadeSource());
  if (!map.getLayer(HILLSHADE_LAYER)) map.addLayer(hillshadeLayer(), map.getLayer(IMAGERY_TOP) ? IMAGERY_TOP : BUILDINGS_BEFORE.find((id) => map.getLayer(id)));
  savedLight = map.getLight();
  map.setLight(DROPIN_LIGHT);
  // A touch more contrast and colour: imagery draped on terrain otherwise looks washed out.
  for (const id of IMAGERY_LAYERS) if (map.getLayer(id)) {
    map.setPaintProperty(id, "raster-contrast", 0.1);
    map.setPaintProperty(id, "raster-saturation", 0.12);
  }
  const sky = map.getSky();
  map.setSky(dropInSky(sky));
  return sky;
}

const IMAGERY_LAYERS = ["raster-esri", "raster-usgs"];
let savedLight: ReturnType<MlMap["getLight"]> | undefined;

function disable3d(map: MlMap, sky: SkySpecification | undefined) {
  map.setTerrain(null);
  if (map.getLayer(BUILDINGS_LAYER)) map.removeLayer(BUILDINGS_LAYER);
  if (map.getLayer(HILLSHADE_LAYER)) map.removeLayer(HILLSHADE_LAYER);
  if (map.getSource(HILLSHADE_SOURCE)) map.removeSource(HILLSHADE_SOURCE);
  if (savedLight) map.setLight(savedLight);
  for (const id of IMAGERY_LAYERS) if (map.getLayer(id)) {
    map.setPaintProperty(id, "raster-contrast", 0);
    map.setPaintProperty(id, "raster-saturation", 0);
  }
  if (map.getSource(TERRAIN_SOURCE)) map.removeSource(TERRAIN_SOURCE);
  if (sky) map.setSky(sky);
  map.setMaxPitch(GLOBE_MAX_PITCH);
}

const isTyping = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));
};

export function useDropIn(map: MlMap | null) {
  const view = useUI((s) => s.dropInView);
  const dropped = !!view;
  const picking = useUI((s) => s.dropInPicking);
  /** Globe camera + basemap to return to, and the sky to restore. */
  const saved = useRef<{ camera: CameraView; style: MapStyleId; sky: SkySpecification | undefined } | null>(null);
  const exitToken = useRef(0);

  // ---- enter / re-target / exit -------------------------------------------------
  useEffect(() => {
    if (!map) return;
    if (view) {
      exitToken.current++;
      if (!saved.current) {
        const c = map.getCenter();
        const style = useUI.getState().settings.mapStyle;
        const sky = enable3d(map);
        saved.current = {
          camera: { center: [c.lng, c.lat], zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() },
          style,
          sky,
        };
        // Street level reads best on imagery; the previous basemap comes back on exit.
        if (style !== "satellite") useUI.getState().updateSettings({ mapStyle: "satellite" });
      }
      map.stop();
      const cam = dropInCamera(view, map.getBearing());
      map.flyTo({ ...cam, duration: DROP_DURATION_MS, essential: true });
      // In mountains the terrain under the camera only loads on arrival, and MapLibre lifts the
      // camera out of the ground by flattening it; tilt back to the street-level angle once settled.
      const token = exitToken.current;
      map.once("moveend", () =>
        map.once("idle", () => {
          if (token !== exitToken.current || !useUI.getState().dropInView) return;
          // Mountains: street-level zoom on a peak just stares into the rock. Pull back so the
          // landscape fits (the higher the ground, the further back), keeping the tilt.
          const ground = map.queryTerrainElevation(map.getCenter()) ?? 0;
          if (ground > 1200) {
            map.easeTo({ zoom: ground > 3000 ? 13.2 : 14, pitch: Math.min(cam.pitch, 68), duration: 1600 });
            return;
          }
          if (map.getPitch() < cam.pitch - 8) map.easeTo({ pitch: cam.pitch, duration: 1200 });
        }),
      );
      return;
    }
    const s = saved.current;
    if (!s) return;
    saved.current = null;
    const token = ++exitToken.current;
    map.stop();
    map.flyTo({ ...s.camera, duration: EXIT_DURATION_MS, essential: true });
    // Terrain off only once the flight is over (switching it mid-flight jumps the camera).
    map.once("moveend", () => {
      if (token !== exitToken.current || saved.current) return;
      disable3d(map, s.sky);
    });
    if (s.style !== "satellite" && useUI.getState().settings.mapStyle === "satellite") useUI.getState().updateSettings({ mapStyle: s.style });
  }, [view, map]);

  // ---- leaving the globe page / remount: never stay half dropped-in ----------------
  useEffect(() => {
    if (!map) return;
    return () => {
      const s = saved.current;
      saved.current = null;
      if (s && s.style !== "satellite") useUI.getState().updateSettings({ mapStyle: s.style });
      useUI.setState({ dropInView: null, dropInPicking: false });
    };
  }, [map]);

  // ---- picking: crosshair over the canvas ------------------------------------------
  useEffect(() => {
    if (!map) return;
    // Globe.tsx's mousemove keeps it a crosshair while picking; this covers the first frame.
    const canvas = map.getCanvas();
    canvas.style.cursor = picking ? "crosshair" : "";
  }, [map, picking]);

  // ---- keyboard: Esc exits / cancels, Q/E rotate, arrows pan ----------------------------
  useEffect(() => {
    if (!map || (!dropped && !picking)) return;
    const onKey = (e: KeyboardEvent) => {
      const ui = useUI.getState();
      if (e.key === "Escape") {
        if (ui.dropInPicking) {
          ui.setDropInPicking(false);
          return;
        }
        // An open panel / dialog takes Esc first; the next Esc leaves the street view.
        if (ui.searchOpen || ui.settingsOpen || ui.selectedEventId || ui.selectedTrack || ui.selectedCountry || ui.selectedRegion !== null || ui.selectedCamera) return;
        if (ui.dropInView) ui.exitDropIn();
        return;
      }
      if (!ui.dropInView || isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === "q" || k === "e") {
        map.easeTo({ bearing: normalizeBearing(map.getBearing() + (k === "q" ? -20 : 20)), duration: 350 });
        return;
      }
      // With the map focused MapLibre's own keyboard handler already pans.
      if (map.getContainer().contains(document.activeElement)) return;
      const step = 120;
      const pan: Record<string, [number, number]> = {
        ArrowUp: [0, -step],
        ArrowDown: [0, step],
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
      };
      if (pan[e.key]) {
        e.preventDefault();
        map.panBy(pan[e.key], { duration: 250 });
      }
    };
    // Capture phase: runs before panels' own Esc handlers close them, so the check above sees them open.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [map, dropped, picking]);
}
