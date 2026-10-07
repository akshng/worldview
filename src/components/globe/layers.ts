/**
 * Data layers rendered on the globe (all WebGL — no DOM markers).
 *
 * Visualisation modes are layer groups toggled by visibility. To add a mode
 * (density, aviation tracks, …) add its layers here and register it in
 * MODE_LAYERS.
 */
import type { ExpressionSpecification, LayerSpecification } from "maplibre-gl";
import { CATEGORY_LIST } from "@/lib/categories";
import type { MapMode } from "@/lib/store/ui";
import type { EventSummary } from "@/types/events";
import { FONT_BOLD, FONT_REGULAR } from "./style";

export const EVENTS_SOURCE = "events";
/** Same events without clustering, for magnitude/intensity styled modes */
export const FLAT_SOURCE = "events-flat";
export const DENSITY_SOURCE = "density";
export const AIRCRAFT_SOURCE = "aircraft";
export const CAMERAS_SOURCE = "cameras";
export const REGIONS_SOURCE = "regions";
export const CAMERA_COLOR = "#2ec4b6";
export const AREAS_SOURCE = "areas";
export const VESSELS_SOURCE = "vessels";
export const COUNTRIES_SOURCE = "countries";
export const NIGHT_SOURCE = "night";
export const ISS_SOURCE = "iss";
export const ISS_TRACK_SOURCE = "iss-track";
export const ISS_COLOR = "#ffb703";
export const AURORA_SOURCE = "aurora";
export const SEARCH_PIN_SOURCE = "search-pin";
export const SEARCH_PIN_COLOR = "#ff4d6d";
/** Aurora probability (%) colour ramp, SWPC-style green → yellow → red */
export const AURORA_STOPS: Array<[number, string]> = [
  [10, "#2fbf71"],
  [30, "#a6e22e"],
  [50, "#ffd43b"],
  [70, "#ff922b"],
  [90, "#f03e3e"],
];
export const ISS_LAYER_IDS = ["iss-track-past", "iss-track-future", "iss-halo", "iss-point", "iss-label"];
export const AURORA_LAYER_IDS = ["aurora"];

export const categoryColor: ExpressionSpecification = [
  "match",
  ["get", "type"],
  ...CATEGORY_LIST.flatMap((c) => [c.id, c.color]),
  "#868e96",
] as unknown as ExpressionSpecification;

const tierColor = (prop: ExpressionSpecification): ExpressionSpecification => [
  "step",
  prop,
  "#8a94a3",
  41,
  "#e0b341",
  61,
  "#ff8a3d",
  81,
  "#ff3b4e",
];

const CLUSTERED = ["area-fill", "area-line", "ev-uncertainty", "ev-cluster", "ev-cluster-count", "ev-halo", "ev-point"];

/** Layers visible in each mode (everything else in ALL_MODE_LAYERS is hidden). */
export const MODE_LAYERS: Record<MapMode, string[]> = {
  events: CLUSTERED,
  heatmap: ["ev-heat"],
  density: ["density-fill", "density-line"],
  weather: CLUSTERED, // + radar rasters managed by the Globe
  fires: ["area-fill", "area-line", "fire-glow", "fire-point"],
  earthquakes: ["eq-point"],
  conflict: CLUSTERED,
  aviation: [...CLUSTERED, "aircraft"],
  maritime: [...CLUSTERED, "vessels"],
  markets: ["market-fill", ...CLUSTERED],
};

/** Diverging scale for daily % change (validated pair: down #e5534b ↔ up #3f8de8, gray midpoint). */
export const MARKET_STOPS: Array<[number, string]> = [
  [-3, "#e5534b"],
  [-1, "#9a4744"],
  [0, "#3a3d44"],
  [1, "#35609a"],
  [3, "#3f8de8"],
];

export const ALL_MODE_LAYERS = [...new Set(Object.values(MODE_LAYERS).flat())];

/** Layers whose features are events (hover preview + click to open). */
export const EVENT_POINT_LAYERS = ["ev-point", "eq-point", "fire-point"];

/** Depth colours used by the earthquake mode and its legend. */
export const DEPTH_STOPS: Array<[number, string]> = [
  [0, "#ff4d4d"],
  [35, "#ff9f43"],
  [70, "#ffd43b"],
  [150, "#69db7c"],
  [300, "#4dabf7"],
  [500, "#9775fa"],
];

export const ALTITUDE_STOPS: Array<[number, string]> = [
  [0, "#ffd43b"],
  [3000, "#69db7c"],
  [8000, "#4dabf7"],
  [11000, "#b197fc"],
];

export const DENSITY_STOPS: Array<[number, string]> = [
  [1, "#2b5d85"],
  [3, "#3b8bc4"],
  [8, "#4fc3e8"],
  [20, "#e0b341"],
  [50, "#ff6b3d"],
];

const stepColor = (prop: ExpressionSpecification, stops: Array<[number, string]>): ExpressionSpecification =>
  ["step", prop, stops[0][1], ...stops.slice(1).flatMap(([v, c]) => [v, c])] as unknown as ExpressionSpecification;

const interpColor = (prop: ExpressionSpecification, stops: Array<[number, string]>): ExpressionSpecification =>
  ["interpolate", ["linear"], prop, ...stops.flatMap(([v, c]) => [v, c])] as unknown as ExpressionSpecification;

/** Mode-specific layers (added below the clustered event layers). */
/** Approximate location uncertainty (km) per precision class, drawn as a ring. */
export const UNCERTAINTY_KM: Record<string, number> = { exact: 0, city: 8, region: 40, approximate: 120, country: 350 };

export function modeLayers(): LayerSpecification[] {
  return [
    {
      id: "area-fill",
      type: "fill",
      source: AREAS_SOURCE,
      paint: {
        "fill-color": categoryColor,
        "fill-opacity": ["case", ["boolean", ["feature-state", "selected"], false], 0.28, 0.1],
      },
    },
    {
      id: "area-line",
      type: "line",
      source: AREAS_SOURCE,
      minzoom: 2.5,
      paint: {
        "line-color": categoryColor,
        "line-opacity": ["case", ["boolean", ["feature-state", "selected"], false], 0.95, 0.45],
        "line-width": ["case", ["boolean", ["feature-state", "selected"], false], 2, 0.8],
      },
    },
    {
      id: "density-fill",
      type: "fill",
      source: DENSITY_SOURCE,
      layout: { visibility: "none" },
      paint: { "fill-color": stepColor(["get", "count"], DENSITY_STOPS), "fill-opacity": 0.72 },
    },
    {
      id: "density-line",
      type: "line",
      source: DENSITY_SOURCE,
      layout: { visibility: "none" },
      paint: { "line-color": "rgba(5,7,10,0.6)", "line-width": 0.5 },
    },
    {
      id: "fire-glow",
      type: "circle",
      source: FLAT_SOURCE,
      layout: { visibility: "none" },
      filter: ["==", ["get", "type"], "FIRE"],
      paint: {
        "circle-color": "#ff6b2c",
        "circle-radius": ["interpolate", ["linear"], ["coalesce", ["get", "frp"], 50], 50, 8, 1000, 16, 10000, 28],
        "circle-opacity": 0.18,
        "circle-blur": 0.8,
      },
    },
    {
      id: "fire-point",
      type: "circle",
      source: FLAT_SOURCE,
      layout: { visibility: "none" },
      filter: ["==", ["get", "type"], "FIRE"],
      paint: {
        "circle-color": interpColor(["coalesce", ["get", "frp"], 50], [[50, "#ffd43b"], [500, "#ff922b"], [3000, "#ff4d1a"], [15000, "#d6001c"]]),
        "circle-radius": ["interpolate", ["linear"], ["coalesce", ["get", "frp"], 50], 50, 3, 1000, 5, 10000, 9],
        "circle-stroke-color": "rgba(5,7,10,0.8)",
        "circle-stroke-width": 0.6,
      },
    },
    {
      id: "eq-point",
      type: "circle",
      source: FLAT_SOURCE,
      layout: { visibility: "none", "circle-sort-key": ["coalesce", ["get", "mag"], 0] },
      filter: ["==", ["get", "type"], "EARTHQUAKE"],
      paint: {
        // Area roughly proportional to energy class: radius grows exponentially with magnitude.
        "circle-radius": ["interpolate", ["exponential", 1.8], ["coalesce", ["get", "mag"], 2.5], 2.5, 3, 5, 8, 7, 22, 9, 46],
        "circle-color": stepColor(["coalesce", ["get", "depth"], 0], DEPTH_STOPS),
        "circle-opacity": 0.55,
        "circle-stroke-color": stepColor(["coalesce", ["get", "depth"], 0], DEPTH_STOPS),
        "circle-stroke-width": 1.2,
      },
    },
  ];
}

/** Live-layer symbol layers (arrows rotated by heading). */
export function liveLayers(): LayerSpecification[] {
  return [
    {
      id: "aircraft",
      type: "symbol",
      source: AIRCRAFT_SOURCE,
      layout: {
        visibility: "none",
        "icon-image": "arrow",
        "icon-size": ["interpolate", ["linear"], ["zoom"], 1, 0.32, 6, 0.6],
        "icon-rotate": ["coalesce", ["get", "track"], 0],
        "icon-rotation-alignment": "map",
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
      },
      paint: {
        "icon-color": interpColor(["coalesce", ["get", "alt"], 0], ALTITUDE_STOPS),
        "icon-opacity": 0.85,
      },
    },
    {
      id: "vessels",
      type: "symbol",
      source: VESSELS_SOURCE,
      layout: {
        visibility: "none",
        "icon-image": "arrow",
        "icon-size": ["interpolate", ["linear"], ["zoom"], 1, 0.26, 7, 0.55],
        "icon-rotate": ["coalesce", ["get", "heading"], 0],
        "icon-rotation-alignment": "map",
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
      },
      paint: {
        "icon-color": ["case", [">", ["coalesce", ["get", "sog"], 0], 0.5], "#4dd4ff", "#6c7a89"],
        "icon-opacity": 0.85,
      },
    },
  ];
}

/** Aggregate events into a lat/lon grid for the density mode. */
export function densityGrid(events: EventSummary[], cellDeg = 2): GeoJSON.FeatureCollection<GeoJSON.Polygon> {
  const cells = new Map<string, { count: number; maxImp: number; la: number; lo: number }>();
  for (const e of events) {
    const la = Math.floor(e.latitude / cellDeg), lo = Math.floor(e.longitude / cellDeg);
    const k = `${la}:${lo}`;
    const c = cells.get(k);
    if (c) {
      c.count++;
      c.maxImp = Math.max(c.maxImp, e.importanceScore);
    } else cells.set(k, { count: 1, maxImp: e.importanceScore, la, lo });
  }
  return {
    type: "FeatureCollection",
    features: [...cells.values()].map((c) => {
      const s = Math.max(-85, c.la * cellDeg), n = Math.min(85, (c.la + 1) * cellDeg);
      const w = c.lo * cellDeg, e = (c.lo + 1) * cellDeg;
      return {
        type: "Feature",
        properties: { count: c.count, maxImp: c.maxImp },
        geometry: { type: "Polygon", coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] },
      };
    }),
  };
}

/** Draws the arrow used for aircraft and vessels (SDF so it can be recoloured). */
export function arrowImage(size = 40): { width: number; height: number; data: Uint8Array } {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.moveTo(size / 2, 2);
  ctx.lineTo(size - 7, size - 4);
  ctx.lineTo(size / 2, size - 12);
  ctx.lineTo(7, size - 4);
  ctx.closePath();
  ctx.fill();
  const img = ctx.getImageData(0, 0, size, size);
  return { width: size, height: size, data: new Uint8Array(img.data.buffer) };
}

export function eventLayers(): LayerSpecification[] {
  return [
    {
      id: "ev-heat",
      type: "heatmap",
      source: EVENTS_SOURCE,
      layout: { visibility: "none" },
      paint: {
        "heatmap-weight": ["interpolate", ["linear"], ["get", "imp"], 0, 0.15, 100, 1],
        "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 0, 0.6, 6, 1.6],
        "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 0, 10, 6, 28],
        "heatmap-opacity": 0.75,
        "heatmap-color": [
          "interpolate",
          ["linear"],
          ["heatmap-density"],
          0, "rgba(0,0,0,0)",
          0.15, "rgba(40,90,140,0.45)",
          0.4, "rgba(80,170,220,0.7)",
          0.7, "rgba(240,200,90,0.85)",
          1, "rgba(255,80,90,0.95)",
        ],
      },
    },
    {
      id: "ev-cluster",
      type: "circle",
      source: EVENTS_SOURCE,
      filter: ["has", "point_count"],
      paint: {
        "circle-color": tierColor(["get", "maxImp"]),
        "circle-opacity": 0.16,
        "circle-stroke-color": tierColor(["get", "maxImp"]),
        "circle-stroke-width": 1.2,
        "circle-stroke-opacity": 0.85,
        "circle-radius": ["step", ["get", "point_count"], 11, 10, 14, 50, 18, 200, 23, 1000, 28],
        "circle-pitch-alignment": "map",
      },
    },
    {
      id: "ev-cluster-count",
      type: "symbol",
      source: EVENTS_SOURCE,
      filter: ["has", "point_count"],
      layout: {
        "text-field": ["get", "point_count_abbreviated"],
        "text-font": FONT_BOLD,
        "text-size": 10.5,
        "text-allow-overlap": true,
      },
      paint: { "text-color": "#eef1f5" },
    },
    {
      // Location uncertainty: ring radius ≈ km of uncertainty at the current zoom.
      id: "ev-uncertainty",
      type: "circle",
      source: EVENTS_SOURCE,
      minzoom: 3,
      filter: ["all", ["!", ["has", "point_count"]], [">", ["get", "uncpx0"], 0]],
      paint: {
        "circle-radius": ["interpolate", ["exponential", 2], ["zoom"], 0, ["get", "uncpx0"], 20, ["*", ["get", "uncpx0"], 1048576]],
        "circle-color": categoryColor,
        "circle-opacity": 0.04,
        "circle-stroke-color": categoryColor,
        "circle-stroke-opacity": 0.35,
        "circle-stroke-width": 1,
        "circle-pitch-alignment": "map",
      },
    },
    {
      id: "ev-halo",
      type: "circle",
      source: EVENTS_SOURCE,
      filter: ["all", ["!", ["has", "point_count"]], [">", ["get", "imp"], 60]],
      paint: {
        "circle-color": categoryColor,
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 1, 9, 8, 18],
        "circle-opacity": 0.14,
        "circle-blur": 0.6,
      },
    },
    {
      id: "ev-point",
      type: "circle",
      source: EVENTS_SOURCE,
      filter: ["!", ["has", "point_count"]],
      paint: {
        "circle-color": categoryColor,
        "circle-opacity": ["get", "op"],
        "circle-radius": [
          "interpolate",
          ["linear"],
          ["zoom"],
          1,
          ["interpolate", ["linear"], ["get", "imp"], 0, 2.5, 100, 6],
          8,
          ["interpolate", ["linear"], ["get", "imp"], 0, 4.5, 100, 11],
        ],
        "circle-stroke-color": "rgba(5,7,10,0.85)",
        "circle-stroke-width": 0.8,
      },
    },
    {
      id: "ev-hover",
      type: "circle",
      source: EVENTS_SOURCE,
      filter: ["==", ["get", "id"], "__none__"],
      paint: {
        "circle-color": "rgba(0,0,0,0)",
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 1, 9, 8, 15],
        "circle-stroke-color": "rgba(255,255,255,0.75)",
        "circle-stroke-width": 1.2,
      },
    },
    {
      id: "ev-selected",
      type: "circle",
      source: EVENTS_SOURCE,
      filter: ["==", ["get", "id"], "__none__"],
      paint: {
        "circle-color": "rgba(0,0,0,0)",
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 1, 11, 8, 18],
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 2,
      },
    },
    {
      id: "ev-label",
      type: "symbol",
      source: EVENTS_SOURCE,
      minzoom: 3.5,
      filter: ["!", ["has", "point_count"]],
      layout: {
        visibility: "none",
        "text-field": ["get", "title"],
        "text-font": FONT_REGULAR,
        "text-size": 10.5,
        "text-offset": [0, 1.1],
        "text-anchor": "top",
        "text-max-width": 14,
        "symbol-sort-key": ["-", 100, ["get", "imp"]],
      },
      paint: { "text-color": "#cfd6e0", "text-halo-color": "rgba(5,7,10,0.9)", "text-halo-width": 1.2 },
    },
  ];
}

export function countryLayers(): LayerSpecification[] {
  return [
    {
      // Markets mode: feature-state `chg` = daily % change of the country's main index.
      id: "market-fill",
      type: "fill",
      source: COUNTRIES_SOURCE,
      layout: { visibility: "none" },
      paint: {
        "fill-color": [
          "interpolate",
          ["linear"],
          ["coalesce", ["feature-state", "chg"], 0],
          ...MARKET_STOPS.flatMap(([v, c]) => [v, c]),
        ] as unknown as ExpressionSpecification,
        "fill-opacity": ["case", ["==", ["typeof", ["feature-state", "chg"]], "number"], 0.6, 0],
      },
    },
    {
      id: "country-fill",
      type: "fill",
      source: COUNTRIES_SOURCE,
      paint: {
        "fill-color": "#9cc9ff",
        "fill-opacity": [
          "case",
          ["boolean", ["feature-state", "selected"], false],
          0.08,
          ["boolean", ["feature-state", "hover"], false],
          0.045,
          0,
        ],
      },
    },
    {
      id: "country-outline",
      type: "line",
      source: COUNTRIES_SOURCE,
      paint: {
        "line-color": "#9cc9ff",
        "line-width": 1.2,
        "line-opacity": ["case", ["boolean", ["feature-state", "selected"], false], 0.7, 0],
      },
    },
  ];
}

export function nightLayer(): LayerSpecification {
  return {
    id: "night",
    type: "fill",
    source: NIGHT_SOURCE,
    paint: { "fill-color": "#000208", "fill-opacity": 0.16, "fill-antialias": false },
  };
}

/** Convert events to GeoJSON. `op` fades older events within the visible window. */
export function toFeatureCollection(
  events: EventSummary[],
  window: { from: number; to: number },
): GeoJSON.FeatureCollection<GeoJSON.Point> {
  const span = Math.max(window.to - window.from, 1);
  return {
    type: "FeatureCollection",
    features: events.map((e) => {
      const t = Math.min(Date.parse(e.timestamp), window.to);
      const fresh = Math.max(0, Math.min(1, (t - window.from) / span));
      // Areas are drawn as polygons, so only point events get an uncertainty ring.
      const uncKm = e.area ? 0 : (UNCERTAINTY_KM[e.geoPrecision] ?? 0);
      const uncpx0 = uncKm / (78.2715 * Math.max(Math.cos((e.latitude * Math.PI) / 180), 0.05));
      return {
        type: "Feature",
        geometry: { type: "Point", coordinates: [e.longitude, e.latitude] },
        properties: {
          id: e.id,
          type: e.type,
          imp: e.importanceScore,
          mag: typeof e.metrics.magnitude === "number" ? e.metrics.magnitude : null,
          depth: typeof e.metrics.depth_km === "number" ? e.metrics.depth_km : null,
          frp: typeof e.metrics.frp_total_mw === "number" ? e.metrics.frp_total_mw : null,
          title: e.title.length > 60 ? `${e.title.slice(0, 57)}…` : e.title,
          op: 0.5 + 0.5 * fresh,
          uncpx0,
        },
      };
    }),
  };
}

/** Polygons for area events (warning areas, fire footprints). Feature id = event index for feature-state. */
export function areaCollection(events: EventSummary[]): { fc: GeoJSON.FeatureCollection; ids: Map<string, number> } {
  const ids = new Map<string, number>();
  const features: GeoJSON.Feature[] = [];
  for (const e of events) {
    if (!e.area) continue;
    const fid = features.length + 1;
    ids.set(e.id, fid);
    features.push({ type: "Feature", id: fid, properties: { id: e.id, type: e.type }, geometry: e.area as GeoJSON.Geometry });
  }
  return { fc: { type: "FeatureCollection", features }, ids };
}

/** Public camera markers (clustered); shown in every map mode when enabled. */
export function cameraLayers(): LayerSpecification[] {
  return [
    {
      id: "cam-cluster",
      type: "circle",
      source: CAMERAS_SOURCE,
      filter: ["has", "point_count"],
      layout: { visibility: "none" },
      paint: {
        "circle-color": "rgba(46,196,182,0.18)",
        "circle-stroke-color": CAMERA_COLOR,
        "circle-stroke-width": 1.2,
        "circle-radius": ["interpolate", ["linear"], ["get", "point_count"], 2, 9, 50, 14, 500, 20],
      },
    },
    {
      id: "cam-count",
      type: "symbol",
      source: CAMERAS_SOURCE,
      filter: ["has", "point_count"],
      layout: { visibility: "none", "text-field": ["get", "point_count_abbreviated"], "text-font": ["Noto Sans Bold"], "text-size": 10, "text-allow-overlap": true },
      paint: { "text-color": CAMERA_COLOR },
    },
    {
      id: "cam-point",
      type: "circle",
      source: CAMERAS_SOURCE,
      filter: ["!", ["has", "point_count"]],
      layout: { visibility: "none" },
      paint: {
        "circle-color": CAMERA_COLOR,
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 3, 12, 6],
        "circle-stroke-color": "#05070a",
        "circle-stroke-width": 1.2,
      },
    },
  ];
}

/** States/provinces: faint outlines, hover and selection, from REGION_ZOOM up. */
export function regionLayers(minzoom: number): LayerSpecification[] {
  return [
    {
      id: "region-fill",
      type: "fill",
      source: REGIONS_SOURCE,
      minzoom,
      paint: {
        "fill-color": "#9cc9ff",
        "fill-opacity": ["case", ["boolean", ["feature-state", "selected"], false], 0.09, ["boolean", ["feature-state", "hover"], false], 0.05, 0],
      },
    },
    {
      id: "region-outline",
      type: "line",
      source: REGIONS_SOURCE,
      minzoom,
      paint: {
        "line-color": "#9cc9ff",
        "line-width": ["case", ["boolean", ["feature-state", "selected"], false], 1.4, 0.5],
        "line-opacity": ["case", ["boolean", ["feature-state", "selected"], false], 0.8, ["boolean", ["feature-state", "hover"], false], 0.5, 0.14],
      },
    },
  ];
}

/** OVATION aurora probability cells (1° grid) as soft graduated circles. Hidden until toggled. */
export function auroraLayers(): LayerSpecification[] {
  return [
    {
      id: "aurora",
      type: "circle",
      source: AURORA_SOURCE,
      layout: { visibility: "none" },
      paint: {
        "circle-color": interpColor(["get", "p"], AURORA_STOPS),
        // Roughly one grid degree on screen, so neighbouring cells merge into a band.
        "circle-radius": ["interpolate", ["exponential", 2], ["zoom"], 0, 1.4, 3, 9, 6, 60],
        "circle-blur": 0.8,
        "circle-opacity": ["interpolate", ["linear"], ["get", "p"], 10, 0.22, 50, 0.45, 90, 0.6],
        "circle-pitch-alignment": "map",
      },
    },
  ];
}

/** ISS ground track (past solid, next 90 min dashed) and station marker. Hidden until toggled. */
export function issLayers(): LayerSpecification[] {
  return [
    {
      id: "iss-track-past",
      type: "line",
      source: ISS_TRACK_SOURCE,
      filter: ["==", ["get", "part"], "past"],
      layout: { visibility: "none", "line-cap": "round" },
      paint: { "line-color": ISS_COLOR, "line-width": 1.4, "line-opacity": 0.55 },
    },
    {
      id: "iss-track-future",
      type: "line",
      source: ISS_TRACK_SOURCE,
      filter: ["==", ["get", "part"], "future"],
      layout: { visibility: "none" },
      paint: { "line-color": ISS_COLOR, "line-width": 1.4, "line-opacity": 0.8, "line-dasharray": [2, 2] },
    },
    {
      id: "iss-halo",
      type: "circle",
      source: ISS_SOURCE,
      layout: { visibility: "none" },
      paint: { "circle-color": ISS_COLOR, "circle-opacity": 0.18, "circle-radius": 13, "circle-blur": 0.4 },
    },
    {
      id: "iss-point",
      type: "circle",
      source: ISS_SOURCE,
      layout: { visibility: "none" },
      paint: { "circle-color": ISS_COLOR, "circle-radius": 5.5, "circle-stroke-color": "#05070a", "circle-stroke-width": 1.5 },
    },
    {
      id: "iss-label",
      type: "symbol",
      source: ISS_SOURCE,
      layout: {
        visibility: "none",
        "text-field": "ISS",
        "text-font": FONT_BOLD,
        "text-size": 11,
        "text-offset": [0, 1.3],
        "text-anchor": "top",
        "text-allow-overlap": true,
        "text-ignore-placement": true,
      },
      paint: { "text-color": ISS_COLOR, "text-halo-color": "#05070a", "text-halo-width": 1.2 },
    },
  ];
}

/** Temporary marker for the place picked in search: a pulse ring, a dot and its name. */
export function searchPinLayers(): LayerSpecification[] {
  return [
    {
      id: "search-pin-halo",
      type: "circle",
      source: SEARCH_PIN_SOURCE,
      paint: { "circle-color": SEARCH_PIN_COLOR, "circle-opacity": 0.2, "circle-radius": 16, "circle-blur": 0.35 },
    },
    {
      id: "search-pin-point",
      type: "circle",
      source: SEARCH_PIN_SOURCE,
      paint: { "circle-color": SEARCH_PIN_COLOR, "circle-radius": 6, "circle-stroke-color": "#ffffff", "circle-stroke-width": 2 },
    },
    {
      id: "search-pin-label",
      type: "symbol",
      source: SEARCH_PIN_SOURCE,
      layout: {
        "text-field": ["get", "name"],
        "text-font": FONT_BOLD,
        "text-size": 12,
        "text-offset": [0, 1.25],
        "text-anchor": "top",
        "text-max-width": 14,
        "text-allow-overlap": true,
        "text-ignore-placement": true,
      },
      paint: { "text-color": "#ffffff", "text-halo-color": "#05070a", "text-halo-width": 1.5 },
    },
  ];
}

export function searchPinCollection(pin: { lon: number; lat: number; name: string } | null): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: pin ? [{ type: "Feature", properties: { name: pin.name }, geometry: { type: "Point", coordinates: [pin.lon, pin.lat] } }] : [],
  };
}
