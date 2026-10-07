/**
 * Strategic infrastructure layers: static, openly licensed datasets built once by
 * `npm run geo:infra` (scripts/build-infra.ts) into public/geo/infra/*.geojson
 * and loaded by the browser only when a layer is switched on.
 *
 * Shared by the build script, the map and the infrastructure panel.
 */

export const INFRA_LAYER_IDS = [
  "cables",
  "landing",
  "power",
  "nuclear",
  "pipelines",
  "lng",
  "ports",
  "datacenters",
  "bases",
  "chokepoints",
] as const;
export type InfraLayerId = (typeof INFRA_LAYER_IDS)[number];

export interface InfraDataset {
  id: string;
  name: string;
  licence: string;
  url: string;
  attribution: string;
}

export const INFRA_DATASETS = {
  osm: {
    id: "osm",
    name: "OpenStreetMap (Overpass API extract)",
    licence: "ODbL 1.0",
    url: "https://www.openstreetmap.org/copyright",
    attribution: "© OpenStreetMap contributors",
  },
  gppd: {
    id: "gppd",
    name: "WRI Global Power Plant Database v1.3",
    licence: "CC BY 4.0",
    url: "https://datasets.wri.org/dataset/globalpowerplantdatabase",
    attribution: "WRI et al., Global Power Plant Database v1.3 (2021)",
  },
  wpi: {
    id: "wpi",
    name: "NGA World Port Index (Pub. 150)",
    licence: "Public domain (U.S. Government work)",
    url: "https://msi.nga.mil/Publications/WPI",
    attribution: "NGA World Port Index",
  },
  curated: {
    id: "curated",
    name: "WorldView curated list",
    licence: "Apache-2.0 (this project)",
    url: "https://en.wikipedia.org/wiki/Chokepoint#Maritime_chokepoints",
    attribution: "Approximate centres and radii, hand-placed",
  },
} as const satisfies Record<string, InfraDataset>;
export type InfraDatasetId = keyof typeof INFRA_DATASETS;

export interface InfraLayerMeta {
  id: InfraLayerId;
  label: string;
  /** File under /geo/infra/ (without extension); null = generated in the browser */
  file: string | null;
  color: string;
  sources: InfraDatasetId[];
  note: string;
}

export const INFRA_LAYERS: InfraLayerMeta[] = [
  { id: "cables", label: "Subsea cables", file: "cables", color: "#2fd3c5", sources: ["osm"], note: "Telecom cables mapped in OSM — partial coverage of the global network." },
  { id: "landing", label: "Landing points", file: "landing-points", color: "#c7fff8", sources: ["osm"], note: "Mapped landing stations plus cable ends on or near the coast." },
  { id: "power", label: "Power plants", file: "power-plants", color: "#8bd450", sources: ["gppd"], note: "Plants ≥ 30 MW (2021 snapshot), coloured by primary fuel." },
  { id: "nuclear", label: "Nuclear plants", file: "power-plants", color: "#ffe14d", sources: ["gppd"], note: "All nuclear plants in the database (2021 snapshot)." },
  { id: "pipelines", label: "Oil & gas pipelines", file: "pipelines", color: "#ff9f43", sources: ["osm"], note: "Named pipeline routes mapped in OSM — not exhaustive." },
  { id: "lng", label: "LNG terminals", file: "lng", color: "#7cc7ff", sources: ["osm", "wpi"], note: "OSM LNG terminals/tank farms and World Port Index ports with an LNG terminal." },
  { id: "ports", label: "Ports", file: "ports", color: "#5b8cff", sources: ["wpi"], note: "World Port Index ports, sized by harbour size." },
  { id: "datacenters", label: "Data centres", file: "datacenters", color: "#c08cff", sources: ["osm"], note: "Features tagged telecom=data_center in OSM." },
  { id: "bases", label: "Military bases", file: "bases", color: "#ff5d5d", sources: ["osm"], note: "Features tagged military=base or naval_base in OSM; locations as mapped publicly." },
  { id: "chokepoints", label: "Chokepoints", file: null, color: "#ffc53d", sources: ["curated"], note: "Maritime chokepoints with a recent-events monitor." },
];

export const INFRA_LAYER_BY_ID = Object.fromEntries(INFRA_LAYERS.map((l) => [l.id, l])) as Record<InfraLayerId, InfraLayerMeta>;

/** Power-plant fuel colours (GPPD primary_fuel values). */
export const FUEL_COLORS: Record<string, string> = {
  Coal: "#8d8d8d",
  Gas: "#ff9f43",
  Oil: "#c0662b",
  Nuclear: "#ffe14d",
  Hydro: "#3fa7ff",
  Wind: "#9ee6ff",
  Solar: "#ffd166",
  Geothermal: "#e76f51",
  Biomass: "#6ab04c",
  Waste: "#8a6f4d",
  Storage: "#b388ff",
  Other: "#aaaaaa",
};
export const fuelColor = (fuel: string) => FUEL_COLORS[fuel] ?? FUEL_COLORS.Other;

/** Pipeline substance colours. */
export const PIPELINE_COLORS: Record<string, string> = { gas: "#ff9f43", oil: "#d9480f", products: "#f783ac", unspecified: "#ced4da" };

/** Written by the build next to the layer files. */
export interface InfraMeta {
  builtAt: string;
  layers: Record<string, { count: number; bytes: number }>;
}

export const infraUrl = (file: string) => `/geo/infra/${file}.geojson`;
