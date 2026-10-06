/**
 * Basemap style. Vector tiles: OpenFreeMap (OpenMapTiles schema, no key).
 * Imagery: NASA GIBS Blue Marble / Black Marble (public domain, no key), and
 * EOX Sentinel-2 cloudless (10 m, CC BY-NC-SA 4.0, no key) when zoomed in on satellite.
 * All basemap variants live in one style and are toggled by visibility, so
 * switching styles never reloads our data layers.
 */
import type { ExpressionSpecification, LayerSpecification, StyleSpecification } from "maplibre-gl";

export const FONT_REGULAR = ["Noto Sans Regular"];
export const FONT_BOLD = ["Noto Sans Bold"];

const name: ExpressionSpecification = ["coalesce", ["get", "name:en"], ["get", "name_en"], ["get", "name"]];

export type BasemapId = "dark" | "satellite" | "night";

/** Layers that belong to each basemap variant (shared ones are always visible). */
export const BASEMAP_LAYERS: Record<BasemapId, string[]> = {
  dark: ["bg-land", "water", "landcover-ice", "roads-major"],
  satellite: ["bg-ocean", "raster-bluemarble", "raster-s2"],
  night: ["bg-ocean", "raster-blackmarble"],
};

const ALL_VARIANT_LAYERS = [...new Set(Object.values(BASEMAP_LAYERS).flat())];

export function variantVisibility(id: BasemapId): Record<string, "visible" | "none"> {
  const out: Record<string, "visible" | "none"> = {};
  for (const l of ALL_VARIANT_LAYERS) out[l] = BASEMAP_LAYERS[id].includes(l) ? "visible" : "none";
  return out;
}

export function buildStyle(variant: BasemapId): StyleSpecification {
  const vis = variantVisibility(variant);
  const v = (id: string) => ({ visibility: vis[id] ?? "visible" }) as const;

  const layers: LayerSpecification[] = [
    { id: "bg-land", type: "background", paint: { "background-color": "#141920" }, layout: v("bg-land") },
    { id: "bg-ocean", type: "background", paint: { "background-color": "#04070b" }, layout: v("bg-ocean") },
    {
      id: "raster-bluemarble",
      type: "raster",
      source: "bluemarble",
      layout: v("raster-bluemarble"),
      paint: { "raster-brightness-max": 0.78, "raster-saturation": -0.25, "raster-contrast": 0.05 },
    },
    {
      // Sharp 10 m imagery once zoomed in; Blue Marble shows the whole globe below it.
      id: "raster-s2",
      type: "raster",
      source: "s2cloudless",
      minzoom: 4,
      layout: v("raster-s2"),
      paint: { "raster-brightness-max": 0.9, "raster-fade-duration": 200, "raster-opacity": ["interpolate", ["linear"], ["zoom"], 4, 0, 5, 1] },
    },
    {
      id: "raster-blackmarble",
      type: "raster",
      source: "blackmarble",
      layout: v("raster-blackmarble"),
      paint: { "raster-brightness-max": 0.95, "raster-saturation": -0.3 },
    },
    {
      id: "water",
      type: "fill",
      source: "omt",
      "source-layer": "water",
      layout: v("water"),
      paint: { "fill-color": "#070a0f" },
    },
    {
      id: "landcover-ice",
      type: "fill",
      source: "omt",
      "source-layer": "landcover",
      filter: ["==", ["get", "class"], "ice"],
      layout: v("landcover-ice"),
      paint: { "fill-color": "#1b2129", "fill-opacity": 0.6 },
    },
    {
      id: "roads-major",
      type: "line",
      source: "omt",
      "source-layer": "transportation",
      minzoom: 5,
      filter: ["in", ["get", "class"], ["literal", ["motorway", "trunk", "primary"]]],
      layout: { ...v("roads-major"), "line-cap": "round" },
      paint: {
        "line-color": "#262d37",
        "line-width": ["interpolate", ["linear"], ["zoom"], 5, 0.3, 10, 1.2],
      },
    },
    {
      id: "boundary-state",
      type: "line",
      source: "omt",
      "source-layer": "boundary",
      minzoom: 3,
      filter: ["all", ["==", ["get", "admin_level"], 4], ["!=", ["get", "maritime"], 1]],
      paint: {
        "line-color": "rgba(150,165,185,0.22)",
        "line-width": ["interpolate", ["linear"], ["zoom"], 3, 0.3, 8, 0.9],
        "line-dasharray": [2, 2],
      },
    },
    {
      id: "boundary-country",
      type: "line",
      source: "omt",
      "source-layer": "boundary",
      filter: ["all", ["==", ["get", "admin_level"], 2], ["!=", ["get", "maritime"], 1], ["!=", ["get", "disputed"], 1]],
      paint: {
        "line-color": "rgba(170,185,205,0.42)",
        "line-width": ["interpolate", ["linear"], ["zoom"], 0, 0.4, 4, 0.9, 8, 1.6],
      },
    },
    {
      id: "boundary-disputed",
      type: "line",
      source: "omt",
      "source-layer": "boundary",
      filter: ["all", ["==", ["get", "admin_level"], 2], ["==", ["get", "disputed"], 1]],
      paint: { "line-color": "rgba(170,185,205,0.35)", "line-width": 0.8, "line-dasharray": [3, 2] },
    },
  ];

  return {
    version: 8,
    projection: { type: "globe" },
    glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
    sky: {
      "sky-color": "#05070a",
      "horizon-color": "#0f2236",
      "fog-color": "#05070a",
      "sky-horizon-blend": 0.6,
      "horizon-fog-blend": 0.6,
      "fog-ground-blend": 0.9,
      "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 0.85, 5, 0.4, 7, 0],
    },
    sources: {
      omt: {
        type: "vector",
        url: "https://tiles.openfreemap.org/planet",
        attribution:
          '<a href="https://openfreemap.org" target="_blank" rel="noopener noreferrer">OpenFreeMap</a> © <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener noreferrer">OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>',
      },
      bluemarble: {
        type: "raster",
        tiles: [
          "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_ShadedRelief_Bathymetry/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg",
        ],
        tileSize: 256,
        maxzoom: 8,
        attribution: "Imagery: NASA Blue Marble via NASA GIBS",
      },
      s2cloudless: {
        type: "raster",
        tiles: ["https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/g/{z}/{y}/{x}.jpg"],
        tileSize: 256,
        minzoom: 4,
        maxzoom: 15,
        attribution:
          '<a href="https://s2maps.eu" target="_blank" rel="noopener noreferrer">Sentinel-2 cloudless – s2maps.eu</a> by EOX IT Services GmbH (contains modified Copernicus Sentinel data 2024)',
      },
      blackmarble: {
        type: "raster",
        tiles: [
          "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_Black_Marble/default/2016-01-01/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png",
        ],
        tileSize: 256,
        maxzoom: 8,
        attribution: "Imagery: NASA Black Marble via NASA GIBS",
      },
    },
    layers,
  };
}

/** Label layers are added after data layers so they sit on top of the night shading. */
export function labelLayers(): LayerSpecification[] {
  const halo = { "text-halo-color": "rgba(5,7,10,0.85)", "text-halo-width": 1.2 };
  return [
    {
      id: "label-water",
      type: "symbol",
      source: "omt",
      "source-layer": "water_name",
      filter: ["==", ["get", "class"], "ocean"],
      layout: { "text-field": name, "text-font": FONT_REGULAR, "text-size": 11, "text-letter-spacing": 0.25, "text-transform": "uppercase" },
      paint: { "text-color": "rgba(120,140,165,0.45)" },
    },
    {
      id: "label-country",
      type: "symbol",
      source: "omt",
      "source-layer": "place",
      minzoom: 1.5,
      maxzoom: 8,
      filter: ["==", ["get", "class"], "country"],
      layout: {
        "text-field": name,
        "text-font": FONT_BOLD,
        "text-size": ["interpolate", ["linear"], ["zoom"], 2, 9.5, 5, 13],
        "text-transform": "uppercase",
        "text-letter-spacing": 0.12,
        "text-max-width": 7,
      },
      paint: { "text-color": "rgba(205,214,226,0.62)", ...halo },
    },
    {
      id: "label-state",
      type: "symbol",
      source: "omt",
      "source-layer": "place",
      minzoom: 3.4,
      filter: ["==", ["get", "class"], "state"],
      layout: { "text-field": name, "text-font": FONT_REGULAR, "text-size": 10, "text-transform": "uppercase", "text-letter-spacing": 0.1 },
      paint: { "text-color": "rgba(160,172,190,0.45)", ...halo },
    },
    {
      id: "label-city",
      type: "symbol",
      source: "omt",
      "source-layer": "place",
      minzoom: 3.5,
      filter: ["in", ["get", "class"], ["literal", ["city", "town"]]],
      layout: {
        "text-field": name,
        "text-font": FONT_REGULAR,
        "text-size": ["interpolate", ["linear"], ["zoom"], 4, 10, 10, 13],
        "symbol-sort-key": ["coalesce", ["get", "rank"], 99],
      },
      paint: { "text-color": "rgba(190,200,214,0.7)", ...halo },
    },
  ];
}
