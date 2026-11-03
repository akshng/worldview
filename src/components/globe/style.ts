/**
 * Basemap style. Vector tiles: OpenFreeMap (OpenMapTiles schema, no key).
 * Imagery (all keyless): NASA GIBS Blue Marble / Black Marble (public domain),
 * EOX Sentinel-2 cloudless 2024 (10 m, CC BY-NC-SA 4.0) from zoom 4, then very-high-
 * resolution Esri World Imagery (Esri terms, attribution) or USGS National Map
 * orthoimagery (US, public domain) from zoom ~11. These are mosaics of past
 * captures; recent GIBS imagery (geostationary / daily) is added at runtime by the
 * globe (see src/lib/imagery) because its tile URLs change with each new image.
 * All basemap variants live in one style and are toggled by visibility, so
 * switching styles never reloads our data layers.
 */
import type { ExpressionSpecification, LayerSpecification, StyleSpecification } from "maplibre-gl";
import { HIRES_FADE, S2_FADE, type HiresProviderId } from "@/lib/imagery";

export const FONT_REGULAR = ["Noto Sans Regular"];
export const FONT_BOLD = ["Noto Sans Bold"];

const name: ExpressionSpecification = ["coalesce", ["get", "name:en"], ["get", "name_en"], ["get", "name"]];

export type BasemapId = "dark" | "satellite" | "night";

/** Invisible marker layer: recent satellite rasters go below it, the clouds overlay above. */
export const IMAGERY_TOP = "imagery-top";

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

export interface BasemapOptions {
  /** Very-high-resolution imagery provider on satellite ("off" stops at Sentinel-2) */
  hires: HiresProviderId;
  /** Roads and place labels drawn over satellite imagery ("hybrid") */
  hybrid: boolean;
}

export const DEFAULT_BASEMAP_OPTIONS: BasemapOptions = { hires: "esri", hybrid: true };

/** Hybrid overlay layers: road lines in the basemap, road/place names with the labels. */
export const HYBRID_LINE_LAYERS = ["hy-roads-minor", "hy-roads-major"];
export const HYBRID_LABEL_LAYERS = ["hy-places", "hy-road-labels"];

/** Visibility of every basemap-controlled layer for a variant + options. */
export function basemapVisibility(id: BasemapId, opts: BasemapOptions): Record<string, "visible" | "none"> {
  const out = variantVisibility(id);
  const sat = id === "satellite";
  out["raster-esri"] = sat && opts.hires === "esri" ? "visible" : "none";
  out["raster-usgs"] = sat && opts.hires === "usgs" ? "visible" : "none";
  for (const l of [...HYBRID_LINE_LAYERS, ...HYBRID_LABEL_LAYERS]) out[l] = sat && opts.hybrid ? "visible" : "none";
  return out;
}

/**
 * Esri World Imagery credit, exactly as the service's copyrightText publishes it
 * (checked Oct 2026: Maxar's imagery business now trades as Vantor).
 */
export const ESRI_ATTRIBUTION =
  'Imagery: <a href="https://www.arcgis.com/home/item.html?id=10df2279f9684e4a9f6a7f08febac2a9" target="_blank" rel="noopener noreferrer">Esri World Imagery</a> — Source: Esri, Vantor, Earthstar Geographics, and the GIS User Community';

export function buildStyle(variant: BasemapId, opts: BasemapOptions = DEFAULT_BASEMAP_OPTIONS): StyleSpecification {
  const vis = basemapVisibility(variant, opts);
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
      paint: {
        "raster-brightness-max": 0.9,
        "raster-fade-duration": 200,
        "raster-opacity": ["interpolate", ["linear"], ["zoom"], S2_FADE[0], 0, S2_FADE[1], 1],
      },
    },
    {
      // Sub-metre imagery in many places (a mosaic of captures from various dates).
      id: "raster-esri",
      type: "raster",
      source: "esri",
      minzoom: HIRES_FADE[0],
      layout: v("raster-esri"),
      paint: {
        "raster-fade-duration": 200,
        "raster-opacity": ["interpolate", ["linear"], ["zoom"], HIRES_FADE[0], 0, HIRES_FADE[1], 1],
      },
    },
    {
      // USGS The National Map orthoimagery: United States only; elsewhere tiles 404 and Sentinel-2 shows through.
      id: "raster-usgs",
      type: "raster",
      source: "usgs",
      minzoom: HIRES_FADE[0],
      layout: v("raster-usgs"),
      paint: {
        "raster-fade-duration": 200,
        "raster-opacity": ["interpolate", ["linear"], ["zoom"], HIRES_FADE[0], 0, HIRES_FADE[1], 1],
      },
    },
    // Recent GIBS imagery is inserted below this marker; the clouds overlay goes above it.
    { id: IMAGERY_TOP, type: "background", layout: { visibility: "none" }, paint: { "background-opacity": 0 } },
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
    {
      id: "hy-roads-minor",
      type: "line",
      source: "omt",
      "source-layer": "transportation",
      minzoom: 12,
      filter: ["in", ["get", "class"], ["literal", ["secondary", "tertiary", "minor"]]],
      layout: { ...v("hy-roads-minor"), "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": "rgba(255,255,255,0.32)",
        "line-width": ["interpolate", ["exponential", 1.6], ["zoom"], 12, 0.4, 18, 5],
      },
    },
    {
      id: "hy-roads-major",
      type: "line",
      source: "omt",
      "source-layer": "transportation",
      minzoom: 7,
      filter: ["in", ["get", "class"], ["literal", ["motorway", "trunk", "primary"]]],
      layout: { ...v("hy-roads-major"), "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": "rgba(255,214,120,0.5)",
        "line-width": ["interpolate", ["exponential", 1.6], ["zoom"], 7, 0.4, 12, 1.4, 18, 9],
      },
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
      esri: {
        type: "raster",
        tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
        tileSize: 256,
        minzoom: 10,
        maxzoom: 19,
        attribution: ESRI_ATTRIBUTION,
      },
      usgs: {
        type: "raster",
        tiles: ["https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}"],
        tileSize: 256,
        minzoom: 10,
        // Cached tiles stop at level 16 (~2.4 m/px at the equator); deeper zooms over-scale them.
        maxzoom: 16,
        attribution:
          'Imagery: <a href="https://www.usgs.gov/programs/national-geospatial-program/national-map" target="_blank" rel="noopener noreferrer">USGS The National Map</a> orthoimagery (USDA NAIP; public domain)',
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
    {
      id: "hy-places",
      type: "symbol",
      source: "omt",
      "source-layer": "place",
      minzoom: 11,
      filter: ["in", ["get", "class"], ["literal", ["village", "suburb", "neighbourhood", "hamlet", "quarter"]]],
      layout: { visibility: "none", "text-field": name, "text-font": FONT_REGULAR, "text-size": ["interpolate", ["linear"], ["zoom"], 11, 10, 16, 13] },
      paint: { "text-color": "rgba(235,240,246,0.85)", ...halo },
    },
    {
      id: "hy-road-labels",
      type: "symbol",
      source: "omt",
      "source-layer": "transportation_name",
      minzoom: 13,
      layout: {
        visibility: "none",
        "symbol-placement": "line",
        "text-field": name,
        "text-font": FONT_REGULAR,
        "text-size": ["interpolate", ["linear"], ["zoom"], 13, 10, 18, 13],
        "text-max-angle": 30,
      },
      paint: { "text-color": "rgba(240,240,232,0.9)", ...halo },
    },
  ];
}

// ---------------------------------------------------------------------------
// "Drop in" street-level view: terrain + 3D buildings, added only while dropped in.
// ---------------------------------------------------------------------------

export const TERRAIN_SOURCE = "dropin-terrain";
export const BUILDINGS_LAYER = "dropin-buildings";
export const TERRAIN_EXAGGERATION = 1.3;

/** AWS Open Data / Mapzen Terrain Tiles (terrarium PNG, keyless). */
export function terrainSource() {
  return {
    type: "raster-dem" as const,
    tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"],
    encoding: "terrarium" as const,
    tileSize: 256,
    maxzoom: 15,
    attribution:
      'Terrain Tiles: <a href="https://registry.opendata.aws/terrain-tiles/" target="_blank" rel="noopener noreferrer">Mapzen/AWS Open Data</a>',
  };
}

export const HILLSHADE_SOURCE = "dropin-hillshade-dem";
export const HILLSHADE_LAYER = "dropin-hillshade";

/**
 * Relief shading from the same elevation tiles (MapLibre wants a separate source for
 * hillshade): slopes facing away from the light darken, so ridges and valleys read in 3D
 * even where the satellite photo is flat.
 */
export function hillshadeSource() {
  return { ...terrainSource(), attribution: undefined };
}
export function hillshadeLayer(): LayerSpecification {
  return {
    id: HILLSHADE_LAYER,
    type: "hillshade",
    source: HILLSHADE_SOURCE,
    paint: {
      "hillshade-exaggeration": ["interpolate", ["linear"], ["zoom"], 10, 0.45, 15, 0.25, 17, 0.12],
      "hillshade-shadow-color": "#1d2733",
      "hillshade-highlight-color": "#fff8ea",
      "hillshade-accent-color": "#3b4a5c",
      "hillshade-illumination-direction": 315,
    },
  };
}

/** Sun-like light for extruded buildings: lit roofs, shaded walls facing away. */
export const DROPIN_LIGHT = { anchor: "map" as const, position: [1.4, 210, 35] as [number, number, number], color: "#fff4e0", intensity: 0.42 };

/** OpenFreeMap (OpenMapTiles schema) building footprints extruded to their OSM heights, from zoom 14. */
export function buildingsLayer(): LayerSpecification {
  const height: ExpressionSpecification = ["coalesce", ["get", "render_height"], ["get", "height"], 6];
  const base: ExpressionSpecification = ["coalesce", ["get", "render_min_height"], ["get", "min_height"], 0];
  // Mapped facade colour where OSM has one, else a palette by height: warm low-rise,
  // stone mid-rise, cool glassy towers. The vertical gradient darkens walls toward the ground.
  const byHeight: ExpressionSpecification = ["interpolate", ["linear"], height, 0, "#d9cfc1", 12, "#cfc6ba", 40, "#bfc3c6", 120, "#a9b9c8", 300, "#9fb6cc"];
  return {
    id: BUILDINGS_LAYER,
    type: "fill-extrusion",
    source: "omt",
    "source-layer": "building",
    minzoom: 14,
    filter: ["!=", ["get", "hide_3d"], true],
    paint: {
      // (to-color's fallback must be a constant: an interpolation inside it isn't allowed)
      "fill-extrusion-color": ["case", ["has", "colour"], ["to-color", ["get", "colour"], "#cfc6ba"], byHeight],
      "fill-extrusion-height": ["interpolate", ["linear"], ["zoom"], 14, 0, 14.6, height],
      "fill-extrusion-base": ["interpolate", ["linear"], ["zoom"], 14, 0, 14.6, base],
      "fill-extrusion-opacity": 1,
      "fill-extrusion-vertical-gradient": true,
    },
  };
}

/** Horizon while dropped in: a hazy daylight sky instead of the space-black globe backdrop. */
export const DROPIN_SKY = {
  "sky-color": "#5b8fc7",
  "horizon-color": "#d6e3ef",
  "fog-color": "#dce6ef",
  "sky-horizon-blend": 0.55,
  "horizon-fog-blend": 0.75,
  "fog-ground-blend": 0.9,
  "atmosphere-blend": 0,
} as const;
