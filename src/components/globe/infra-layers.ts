/**
 * Strategic-infrastructure map layers (static GeoJSON from public/geo/infra,
 * loaded on first toggle). Independent of map modes.
 */
import type { ExpressionSpecification, LayerSpecification } from "maplibre-gl";
import { FUEL_COLORS, INFRA_LAYER_BY_ID, PIPELINE_COLORS, type InfraLayerId } from "@/lib/infra/catalog";
import { LEVEL_COLORS } from "@/lib/infra/chokepoints";
import { FONT_BOLD } from "./style";

/** Source per data file (power plants and nuclear share one). */
export const infraSource = (id: InfraLayerId) => `infra-${INFRA_LAYER_BY_ID[id].file ?? id}`;

const zr = (lo: number, hi: number): ExpressionSpecification => ["interpolate", ["linear"], ["zoom"], 1, lo, 8, hi];
const fuelMatch = ["match", ["get", "f"], ...Object.entries(FUEL_COLORS).flat(), FUEL_COLORS.Other] as unknown as ExpressionSpecification;
const substanceMatch = ["match", ["get", "s"], ...Object.entries(PIPELINE_COLORS).flat(), PIPELINE_COLORS.unspecified] as unknown as ExpressionSpecification;
/** Chokepoints: base colour until the monitor has scored them (score -1), then by level. */
const scoreColor: ExpressionSpecification = [
  "step", ["get", "score"], INFRA_LAYER_BY_ID.chokepoints.color,
  0, LEVEL_COLORS.calm, 15, LEVEL_COLORS.watch, 35, LEVEL_COLORS.elevated, 60, LEVEL_COLORS.high,
];

/** Map layers per infrastructure toggle. The first id of each list is the hover/click target. */
export const INFRA_MAP_LAYERS: Record<InfraLayerId, string[]> = {
  cables: ["infra-cables-hit", "infra-cables"],
  landing: ["infra-landing"],
  power: ["infra-power"],
  nuclear: ["infra-nuclear", "infra-nuclear-halo"],
  pipelines: ["infra-pipelines-hit", "infra-pipelines"],
  lng: ["infra-lng"],
  ports: ["infra-ports"],
  datacenters: ["infra-datacenters"],
  bases: ["infra-bases"],
  chokepoints: ["infra-chokepoints-centre", "infra-chokepoints-fill", "infra-chokepoints-line", "infra-chokepoints-label"],
};
/** Hover/click targets, topmost first (points before lines before areas). */
export const INFRA_INTERACTIVE = [
  "infra-chokepoints-centre", "infra-nuclear", "infra-lng", "infra-landing", "infra-bases", "infra-datacenters", "infra-power", "infra-ports",
  "infra-cables-hit", "infra-pipelines-hit", "infra-chokepoints-fill",
];
export const INFRA_LAYER_OF = Object.fromEntries(
  Object.entries(INFRA_MAP_LAYERS).flatMap(([k, ids]) => ids.map((id) => [id, k])),
) as Record<string, InfraLayerId>;

export function infraLayers(): LayerSpecification[] {
  const hidden = { visibility: "none" as const };
  const C = (id: InfraLayerId) => INFRA_LAYER_BY_ID[id].color;
  return [
    {
      id: "infra-chokepoints-fill",
      type: "fill",
      source: infraSource("chokepoints"),
      filter: ["==", ["get", "kind"], "area"],
      layout: hidden,
      paint: { "fill-color": scoreColor, "fill-opacity": 0.12 },
    },
    {
      id: "infra-chokepoints-line",
      type: "line",
      source: infraSource("chokepoints"),
      filter: ["==", ["get", "kind"], "area"],
      layout: hidden,
      paint: { "line-color": scoreColor, "line-width": 1.2, "line-opacity": 0.8, "line-dasharray": [3, 2] },
    },
    {
      id: "infra-pipelines-hit",
      type: "line",
      source: infraSource("pipelines"),
      layout: { ...hidden, "line-cap": "round" },
      paint: { "line-color": "#000", "line-opacity": 0, "line-width": 9 },
    },
    {
      id: "infra-pipelines",
      type: "line",
      source: infraSource("pipelines"),
      layout: { ...hidden, "line-cap": "round", "line-join": "round" },
      paint: { "line-color": substanceMatch, "line-width": zr(1, 2.6), "line-opacity": 0.85 },
    },
    {
      id: "infra-cables-hit",
      type: "line",
      source: infraSource("cables"),
      layout: { ...hidden, "line-cap": "round" },
      paint: { "line-color": "#000", "line-opacity": 0, "line-width": 9 },
    },
    {
      id: "infra-cables",
      type: "line",
      source: infraSource("cables"),
      layout: { ...hidden, "line-cap": "round", "line-join": "round" },
      paint: { "line-color": C("cables"), "line-width": zr(0.9, 2.4), "line-opacity": 0.8 },
    },
    {
      id: "infra-ports",
      type: "circle",
      source: infraSource("ports"),
      layout: hidden,
      paint: {
        "circle-color": C("ports"),
        "circle-opacity": 0.85,
        "circle-radius": [
          "interpolate", ["linear"], ["zoom"],
          1, ["match", ["get", "s"], "L", 3.6, "M", 2.6, "S", 1.8, 1.3],
          8, ["match", ["get", "s"], "L", 7, "M", 5.5, "S", 4.5, 3.5],
        ],
        "circle-stroke-color": "#05070a",
        "circle-stroke-width": 0.6,
      },
    },
    {
      id: "infra-power",
      type: "circle",
      source: infraSource("power"),
      filter: ["!=", ["get", "f"], "Nuclear"],
      layout: hidden,
      paint: {
        "circle-color": fuelMatch,
        "circle-opacity": 0.85,
        "circle-radius": [
          "interpolate", ["linear"], ["zoom"],
          1, ["interpolate", ["linear"], ["get", "mw"], 30, 1.3, 1000, 2.6, 5000, 4.5],
          8, ["interpolate", ["linear"], ["get", "mw"], 30, 3, 1000, 6, 5000, 10],
        ],
        "circle-stroke-color": "#05070a",
        "circle-stroke-width": 0.5,
      },
    },
    {
      id: "infra-nuclear-halo",
      type: "circle",
      source: infraSource("nuclear"),
      filter: ["==", ["get", "f"], "Nuclear"],
      layout: hidden,
      paint: { "circle-color": "rgba(0,0,0,0)", "circle-radius": zr(6, 13), "circle-stroke-color": C("nuclear"), "circle-stroke-width": 1, "circle-stroke-opacity": 0.6 },
    },
    {
      id: "infra-nuclear",
      type: "circle",
      source: infraSource("nuclear"),
      filter: ["==", ["get", "f"], "Nuclear"],
      layout: hidden,
      paint: { "circle-color": C("nuclear"), "circle-radius": zr(3, 6.5), "circle-stroke-color": "#05070a", "circle-stroke-width": 1.2 },
    },
    {
      id: "infra-lng",
      type: "circle",
      source: infraSource("lng"),
      layout: hidden,
      paint: { "circle-color": C("lng"), "circle-radius": zr(3, 6.5), "circle-stroke-color": "#ffffff", "circle-stroke-width": 1.2 },
    },
    {
      id: "infra-datacenters",
      type: "circle",
      source: infraSource("datacenters"),
      layout: hidden,
      paint: { "circle-color": C("datacenters"), "circle-opacity": 0.9, "circle-radius": zr(1.8, 5), "circle-stroke-color": "#05070a", "circle-stroke-width": 0.7 },
    },
    {
      id: "infra-bases",
      type: "circle",
      source: infraSource("bases"),
      layout: hidden,
      paint: {
        // Naval bases filled, other bases hollow.
        "circle-color": ["case", ["==", ["get", "k"], "naval_base"], "rgba(255,93,93,0.85)", "rgba(255,93,93,0.2)"],
        "circle-radius": zr(2.2, 5.5),
        "circle-stroke-color": C("bases"),
        "circle-stroke-width": 1.1,
      },
    },
    {
      id: "infra-landing",
      type: "circle",
      source: infraSource("landing"),
      layout: hidden,
      paint: {
        "circle-color": C("landing"),
        "circle-radius": [
          "interpolate", ["linear"], ["zoom"],
          1, ["case", ["==", ["get", "k"], "station"], 2.6, 1.8],
          8, ["case", ["==", ["get", "k"], "station"], 6, 4.5],
        ],
        "circle-stroke-color": C("cables"),
        "circle-stroke-width": 1,
      },
    },
    {
      id: "infra-chokepoints-centre",
      type: "circle",
      source: infraSource("chokepoints"),
      filter: ["==", ["get", "kind"], "centre"],
      layout: hidden,
      paint: { "circle-color": scoreColor, "circle-radius": zr(4, 7), "circle-stroke-color": "#05070a", "circle-stroke-width": 1.4 },
    },
    {
      id: "infra-chokepoints-label",
      type: "symbol",
      source: infraSource("chokepoints"),
      filter: ["==", ["get", "kind"], "centre"],
      layout: {
        ...hidden,
        "text-field": ["get", "name"],
        "text-font": FONT_BOLD,
        "text-size": 11,
        "text-offset": [0, 1.1],
        "text-anchor": "top",
        "text-max-width": 10,
      },
      paint: { "text-color": INFRA_LAYER_BY_ID.chokepoints.color, "text-halo-color": "#05070a", "text-halo-width": 1.4 },
    },
  ];
}
