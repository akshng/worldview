import type { EventCategory } from "@/types/events";

export interface CategoryMeta {
  id: EventCategory;
  label: string;
  /** Plural label used for layer toggles */
  layerLabel: string;
  color: string;
  /** Natural-hazard categories count towards "active disasters" */
  isHazard: boolean;
}

const c = (
  id: EventCategory,
  label: string,
  layerLabel: string,
  color: string,
  isHazard = false,
): CategoryMeta => ({ id, label, layerLabel, color, isHazard });

export const CATEGORIES: Record<EventCategory, CategoryMeta> = {
  NEWS: c("NEWS", "News", "News", "#9aa7b8"),
  POLITICS: c("POLITICS", "Politics", "Politics", "#7b93ff"),
  CONFLICT: c("CONFLICT", "Conflict", "Conflict", "#ff4d5a"),
  PROTEST: c("PROTEST", "Protest", "Protests", "#f783ac"),
  DISASTER: c("DISASTER", "Disaster", "Disasters", "#f08c00", true),
  EARTHQUAKE: c("EARTHQUAKE", "Earthquake", "Earthquakes", "#ffd43b", true),
  WEATHER: c("WEATHER", "Weather", "Weather", "#4dabf7", true),
  FIRE: c("FIRE", "Fire", "Fires", "#ff6b2c", true),
  FLOOD: c("FLOOD", "Flood", "Floods", "#22b8cf", true),
  VOLCANO: c("VOLCANO", "Volcano", "Volcanoes", "#e64980", true),
  SPACE: c("SPACE", "Space", "Space", "#b197fc"),
  SCIENCE: c("SCIENCE", "Science", "Science", "#69db7c"),
  TECHNOLOGY: c("TECHNOLOGY", "Technology", "Technology", "#38d9a9"),
  BUSINESS: c("BUSINESS", "Business", "Business", "#a9e34b"),
  MARKETS: c("MARKETS", "Markets", "Markets", "#c0eb75"),
  AVIATION: c("AVIATION", "Aviation", "Aviation", "#91a7ff"),
  MARITIME: c("MARITIME", "Maritime", "Maritime", "#4263eb"),
  INFRASTRUCTURE: c("INFRASTRUCTURE", "Infrastructure", "Infrastructure", "#ced4da"),
  HEALTH: c("HEALTH", "Health", "Health", "#ff8787"),
  OTHER: c("OTHER", "Other", "Other", "#868e96"),
};

export const CATEGORY_LIST: CategoryMeta[] = Object.values(CATEGORIES);

export const HAZARD_CATEGORIES = CATEGORY_LIST.filter((c) => c.isHazard).map((c) => c.id);

export type ImportanceLevel = "MINOR" | "LOW" | "MODERATE" | "HIGH" | "CRITICAL";

export function importanceLevel(score: number): ImportanceLevel {
  if (score > 80) return "CRITICAL";
  if (score > 60) return "HIGH";
  if (score > 40) return "MODERATE";
  if (score > 20) return "LOW";
  return "MINOR";
}

export const IMPORTANCE_LEVELS: Record<ImportanceLevel, { label: string; color: string; min: number }> = {
  MINOR: { label: "Minor", color: "#5c6470", min: 0 },
  LOW: { label: "Low", color: "#8a94a3", min: 21 },
  MODERATE: { label: "Moderate", color: "#e0b341", min: 41 },
  HIGH: { label: "High", color: "#ff8a3d", min: 61 },
  CRITICAL: { label: "Critical", color: "#ff3b4e", min: 81 },
};

/** Sidebar importance filter presets → minimum score */
export const IMPORTANCE_FILTERS = [
  { id: "all", label: "All", min: 0 },
  { id: "moderate", label: "Moderate+", min: 41 },
  { id: "high", label: "High+", min: 61 },
  { id: "critical", label: "Critical", min: 81 },
] as const;
export type ImportanceFilterId = (typeof IMPORTANCE_FILTERS)[number]["id"];
