"use client";
/**
 * Client UI state. Settings are persisted to localStorage (per-browser
 * convenience only — nothing here is authoritative data).
 */
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { EVENT_CATEGORIES, type EventCategory } from "@/types/events";
import type { ImportanceFilterId } from "@/lib/categories";
import type { PresetRangeId, TimeRangeId } from "@/lib/time";
import { MAP_MODE_IDS } from "@/lib/map-modes";

export type MapStyleId = "dark" | "satellite" | "night";
export type MapMode = import("@/lib/map-modes").MapModeId;
export type FeedSort = "recent" | "importance";

export interface Settings {
  mapStyle: MapStyleId;
  showEventLabels: boolean;
  showDayNight: boolean;
  /** Public camera markers on the map */
  showCameras: boolean;
  autoRefresh: boolean;
  defaultRange: PresetRangeId;
  defaultCategories: EventCategory[];
  showAI: boolean;
  developerMode: boolean;
  /** Watchlist tickers (Yahoo-style symbols) */
  watchlist: string[];
  /** In-app price alerts (checked while the app is open) */
  alerts: PriceAlert[];
}

export interface PriceAlert {
  symbol: string;
  above: number | null;
  below: number | null;
  /** Side that last fired, so an alert fires once per crossing */
  fired: "above" | "below" | null;
}

export interface Toast {
  id: number;
  title: string;
  body: string;
  symbol?: string;
}

export interface FlyToRequest {
  lon: number;
  lat: number;
  zoom?: number;
  bbox?: [number, number, number, number];
  nonce: number;
}

interface UIState {
  // filters
  categories: EventCategory[];
  range: TimeRangeId;
  customRange: { from: number; to: number } | null;
  importance: ImportanceFilterId;
  timelineSpan: "24h" | "7d";
  /** null = following "now" (live). A number = replay cursor (ms epoch). */
  timelineCursor: number | null;
  mapMode: MapMode;
  feedSort: FeedSort;
  /** Weather radar playback: index into frames (null = latest) */
  radarFrame: number | null;
  radarPlaying: boolean;

  // selection / panels
  selectedEventId: string | null;
  /** Camera open in the viewer: [id, name, lon, lat, sourceIndex, imageUrl, videoUrl, videoKind] + its source */
  selectedCamera: { row: import("@/layers/cameras").CameraRow; source: import("@/layers/cameras").CameraSource } | null;
  selectedCountry: string | null;
  /** State/province selected on the map (id in /geo/regions.geojson) */
  selectedRegion: number | null;
  hoveredEventId: string | null;
  flyTo: FlyToRequest | null;

  // chrome
  sidebarCollapsed: boolean;
  searchOpen: boolean;
  briefingOpen: boolean;
  marketsOpen: boolean;
  planetOpen: boolean;
  securityOpen: boolean;
  trendsOpen: boolean;
  /** Instrument detail view (symbol) */
  instrument: string | null;
  toasts: Toast[];
  settingsOpen: boolean;
  settingsTab: "general" | "map" | "sources" | "about";

  settings: Settings;

  // actions
  toggleCategory: (c: EventCategory) => void;
  setCategories: (c: EventCategory[]) => void;
  setRange: (r: TimeRangeId) => void;
  setCustomRange: (r: { from: number; to: number } | null) => void;
  setImportance: (i: ImportanceFilterId) => void;
  setTimelineSpan: (s: "24h" | "7d") => void;
  setTimelineCursor: (t: number | null) => void;
  setMapMode: (m: MapMode) => void;
  setFeedSort: (s: FeedSort) => void;
  setRadarFrame: (i: number | null) => void;
  setRadarPlaying: (v: boolean) => void;
  selectEvent: (id: string | null) => void;
  selectCamera: (c: UIState["selectedCamera"]) => void;
  selectCountry: (code: string | null) => void;
  selectRegion: (id: number | null) => void;
  setHovered: (id: string | null) => void;
  requestFlyTo: (r: Omit<FlyToRequest, "nonce">) => void;
  setSidebarCollapsed: (v: boolean) => void;
  setSearchOpen: (v: boolean) => void;
  setBriefingOpen: (v: boolean) => void;
  setMarketsOpen: (v: boolean) => void;
  setPlanetOpen: (v: boolean) => void;
  setSecurityOpen: (v: boolean) => void;
  setTrendsOpen: (v: boolean) => void;
  openInstrument: (symbol: string | null) => void;
  pushToast: (t: Omit<Toast, "id">) => void;
  dismissToast: (id: number) => void;
  openSettings: (tab?: UIState["settingsTab"]) => void;
  closeSettings: () => void;
  updateSettings: (patch: Partial<Settings>) => void;
}

const DEFAULT_SETTINGS: Settings = {
  mapStyle: "dark",
  showEventLabels: false,
  showDayNight: true,
  showCameras: false,
  autoRefresh: true,
  defaultRange: "24h",
  defaultCategories: [...EVENT_CATEGORIES],
  showAI: true,
  developerMode: false,
  watchlist: ["SPY", "QQQ", "AAPL", "NVDA"],
  alerts: [],
};

export const useUI = create<UIState>()(
  persist(
    (set) => ({
      categories: [...EVENT_CATEGORIES],
      range: "24h",
      customRange: null,
      importance: "all",
      timelineSpan: "24h",
      timelineCursor: null,
      mapMode: "events",
      feedSort: "recent",
      radarFrame: null,
      radarPlaying: false,
      selectedEventId: null,
      selectedCamera: null,
      selectedCountry: null,
      selectedRegion: null,
      hoveredEventId: null,
      flyTo: null,
      sidebarCollapsed: false,
      searchOpen: false,
      briefingOpen: false,
      marketsOpen: false,
      planetOpen: false,
      securityOpen: false,
      trendsOpen: false,
      instrument: null,
      toasts: [],
      settingsOpen: false,
      settingsTab: "general",
      settings: DEFAULT_SETTINGS,

      toggleCategory: (c) =>
        set((s) => ({ categories: s.categories.includes(c) ? s.categories.filter((x) => x !== c) : [...s.categories, c] })),
      setCategories: (categories) => set({ categories }),
      setRange: (range) =>
        set(() => ({
          range,
          timelineCursor: null,
          ...(range === "7d" ? { timelineSpan: "7d" as const } : {}),
        })),
      setCustomRange: (customRange) => set({ customRange, range: customRange ? "custom" : "24h", timelineCursor: null }),
      setImportance: (importance) => set({ importance }),
      setTimelineSpan: (timelineSpan) =>
        set((s) => ({ timelineSpan, timelineCursor: null, range: timelineSpan === "24h" && s.range === "7d" ? "24h" : s.range })),
      setTimelineCursor: (timelineCursor) => set({ timelineCursor }),
      setMapMode: (mapMode) => set({ mapMode, radarPlaying: false, radarFrame: null }),
      setFeedSort: (feedSort) => set({ feedSort }),
      setRadarFrame: (radarFrame) => set({ radarFrame }),
      setRadarPlaying: (radarPlaying) => set({ radarPlaying }),
      selectCamera: (selectedCamera) => set({ selectedCamera }),
      selectEvent: (selectedEventId) => set({ selectedEventId, ...(selectedEventId ? { selectedCountry: null, selectedRegion: null } : {}) }),
      selectCountry: (selectedCountry) => set({ selectedCountry, ...(selectedCountry ? { selectedEventId: null, selectedRegion: null } : {}) }),
      selectRegion: (selectedRegion) => set({ selectedRegion, ...(selectedRegion !== null ? { selectedEventId: null, selectedCountry: null } : {}) }),
      setHovered: (hoveredEventId) => set({ hoveredEventId }),
      requestFlyTo: (r) => set({ flyTo: { ...r, nonce: Date.now() + Math.random() } }),
      setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
      setSearchOpen: (searchOpen) => set({ searchOpen }),
      setBriefingOpen: (briefingOpen) => set({ briefingOpen }),
      setMarketsOpen: (marketsOpen) => set({ marketsOpen }),
      setPlanetOpen: (planetOpen) => set({ planetOpen }),
      setSecurityOpen: (securityOpen) => set({ securityOpen }),
      setTrendsOpen: (trendsOpen) => set({ trendsOpen }),
      openInstrument: (instrument) => set({ instrument }),
      pushToast: (t) => set((s) => ({ toasts: [...s.toasts.slice(-3), { ...t, id: Date.now() + Math.random() }] })),
      dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
      openSettings: (tab) => set((s) => ({ settingsOpen: true, settingsTab: tab ?? s.settingsTab })),
      closeSettings: () => set({ settingsOpen: false }),
      updateSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),
    }),
    {
      name: "worldview-ui",
      version: 1,
      storage: createJSONStorage(() => {
        try {
          return localStorage;
        } catch {
          return { getItem: () => null, setItem: () => {}, removeItem: () => {} };
        }
      }),
      // Only persist preferences, not transient selection state.
      partialize: (s) => ({ settings: s.settings, sidebarCollapsed: s.sidebarCollapsed, feedSort: s.feedSort, mapMode: s.mapMode }),
      // Apply default layers/range from saved settings on load.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<UIState>;
        const settings = { ...DEFAULT_SETTINGS, ...(p.settings ?? {}) };
        const valid = settings.defaultCategories.filter((c) => (EVENT_CATEGORIES as readonly string[]).includes(c));
        const mapMode = (MAP_MODE_IDS as readonly string[]).includes(String(p.mapMode)) ? p.mapMode! : "events";
        return {
          ...current,
          ...p,
          mapMode,
          settings,
          categories: valid.length ? valid : [...EVENT_CATEGORIES],
          range: settings.defaultRange,
          timelineSpan: settings.defaultRange === "7d" ? "7d" : current.timelineSpan,
        };
      },
    },
  ),
);
