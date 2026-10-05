/** Visualisation modes. A mode can focus event categories and/or add a live layer. */
import type { EventCategory } from "@/types/events";

export const MAP_MODE_IDS = ["events", "heatmap", "density", "weather", "fires", "earthquakes", "conflict", "aviation", "maritime", "markets"] as const;
export type MapModeId = (typeof MAP_MODE_IDS)[number];

export interface MapModeMeta {
  id: MapModeId;
  label: string;
  description: string;
  /** When set, only these categories are shown (overrides layer toggles) */
  categories: EventCategory[] | null;
  /** Live layer to load for this mode */
  liveLayer: "weather-radar" | "aviation" | "maritime" | "markets" | null;
}

export const MAP_MODES: MapModeMeta[] = [
  { id: "events", label: "Events", description: "All events, clustered", categories: null, liveLayer: null },
  { id: "heatmap", label: "Heatmap", description: "Event intensity weighted by importance", categories: null, liveLayer: null },
  { id: "density", label: "Density", description: "Event counts per 2° grid cell", categories: null, liveLayer: null },
  { id: "weather", label: "Weather", description: "Precipitation radar + weather & flood events", categories: ["WEATHER", "FLOOD"], liveLayer: "weather-radar" },
  { id: "fires", label: "Fires", description: "Fire events coloured by radiative power", categories: ["FIRE"], liveLayer: null },
  { id: "earthquakes", label: "Earthquakes", description: "Sized by magnitude, coloured by depth", categories: ["EARTHQUAKE"], liveLayer: null },
  { id: "conflict", label: "Conflict", description: "Conflict and protest reporting", categories: ["CONFLICT", "PROTEST"], liveLayer: null },
  { id: "aviation", label: "Aviation", description: "Live aircraft positions over events", categories: null, liveLayer: "aviation" },
  { id: "maritime", label: "Maritime", description: "Live vessel positions over events", categories: null, liveLayer: "maritime" },
  {
    id: "markets",
    label: "Markets",
    description: "Countries coloured by their main stock index's daily move, with market-relevant events",
    categories: ["CONFLICT", "POLITICS", "BUSINESS", "MARKETS", "EARTHQUAKE", "WEATHER", "INFRASTRUCTURE", "AVIATION", "MARITIME", "TECHNOLOGY", "HEALTH", "DISASTER", "FLOOD"],
    liveLayer: "markets",
  },
];

export function modeMeta(id: MapModeId): MapModeMeta {
  return MAP_MODES.find((m) => m.id === id) ?? MAP_MODES[0];
}
