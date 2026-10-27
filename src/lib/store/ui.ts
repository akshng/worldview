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
import type { HiresProviderId, SatSourceId } from "@/lib/imagery";
import { INFRA_LAYER_IDS, type InfraLayerId } from "@/lib/infra/catalog";


export const APP_VIEWS = ["world", "news", "markets", "analyst", "briefing", "planet", "energy", "security", "trends"] as const;
export type AppView = (typeof APP_VIEWS)[number];

export type MapStyleId = "dark" | "satellite" | "night";
export type MapMode = import("@/lib/map-modes").MapModeId;
export type FeedSort = "recent" | "importance";

export interface Settings {
  mapStyle: MapStyleId;
  /** Satellite view: mosaic (sharpest, past captures) or recent NASA GIBS imagery */
  satSource: SatSourceId;
  /** Very-high-resolution mosaic tiles from zoom ~11 (Esri World Imagery, USGS US-only, or off) */
  hiresProvider: HiresProviderId;
  /** Roads and place names over satellite imagery ("hybrid") */
  satLabels: boolean;
  /** Semi-transparent geostationary infrared clouds over any basemap */
  showClouds: boolean;
  showEventLabels: boolean;
  showDayNight: boolean;
  /** Public camera markers on the map */
  showCameras: boolean;
  /** Only show cameras with a live video stream */
  camerasLiveOnly: boolean;
  /** ISS position + ground track overlay */
  showIss: boolean;
  /** NOAA OVATION aurora forecast overlay */
  showAurora: boolean;
  /** AIS vessel overlay (independent of the Maritime map mode) */
  showShips: boolean;
  /** adsb.lol military-flagged aircraft overlay */
  showMilAir: boolean;
  /** adsb.lol live aircraft around the map view */
  showAircraft: boolean;
  /** CelesTrak satellites propagated with SGP4 */
  showSatellites: boolean;
  /** Strategic infrastructure layers switched on (independent of map modes) */
  infraLayers: InfraLayerId[];
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

/** Temporary marker dropped by place search (cleared by the next search or a map click) */
export interface SearchPin {
  lon: number;
  lat: number;
  name: string;
}

/** A live tracked object open in the detail panel. */
export interface TrackRef {
  kind: "ship" | "aircraft" | "sat";
  /** MMSI, ICAO hex or NORAD id */
  id: string;
  /** Aircraft from the MIL overlay */
  mil?: boolean;
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
  /** Camera open in the viewer: [id, name, lon, lat, sourceIndex, flags] + its source and its health */
  selectedCamera: { row: import("@/lib/cameras").CameraListRow; source: import("@/layers/cameras").CameraSource; health?: import("@/lib/cameras").SourceHealth } | null;
  selectedCountry: string | null;
  /** State/province selected on the map (id in /geo/regions.geojson) */
  selectedRegion: number | null;
  /** Ship / aircraft / satellite open in the track panel (exclusive with event/country/region) */
  selectedTrack: TrackRef | null;
  /** Keep the map centred on the selected track */
  followTrack: boolean;
  hoveredEventId: string | null;
  flyTo: FlyToRequest | null;
  searchPin: SearchPin | null;

  // chrome
  sidebarCollapsed: boolean;
  /** Which page of the app is showing ("world" = the globe dashboard). */
  view: AppView;
  setView: (v: AppView) => void;
  searchOpen: boolean;
  briefingOpen: boolean;
  marketsOpen: boolean;
  planetOpen: boolean;
  /** AI analyst chat panel */
  analystOpen: boolean;
  energyOpen: boolean;
  securityOpen: boolean;
  trendsOpen: boolean;
  /** Infrastructure layer panel (toggles, sources, chokepoint monitor) */
  infraOpen: boolean;
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
  selectTrack: (t: TrackRef | null) => void;
  setFollowTrack: (v: boolean) => void;
  setHovered: (id: string | null) => void;
  requestFlyTo: (r: Omit<FlyToRequest, "nonce">) => void;
  setSearchPin: (p: SearchPin | null) => void;
  setSidebarCollapsed: (v: boolean) => void;
  setSearchOpen: (v: boolean) => void;
  setBriefingOpen: (v: boolean) => void;
  setMarketsOpen: (v: boolean) => void;
  setPlanetOpen: (v: boolean) => void;
  setAnalystOpen: (v: boolean) => void;
  setEnergyOpen: (v: boolean) => void;
  setSecurityOpen: (v: boolean) => void;
  setTrendsOpen: (v: boolean) => void;
  setInfraOpen: (v: boolean) => void;
  toggleInfraLayer: (id: InfraLayerId) => void;
  openInstrument: (symbol: string | null) => void;
  pushToast: (t: Omit<Toast, "id">) => void;
  dismissToast: (id: number) => void;
  openSettings: (tab?: UIState["settingsTab"]) => void;
  closeSettings: () => void;
  updateSettings: (patch: Partial<Settings>) => void;
}

const DEFAULT_SETTINGS: Settings = {
  mapStyle: "dark",
  satSource: "mosaic",
  hiresProvider: "esri",
  satLabels: true,
  showClouds: false,
  showEventLabels: false,
  showDayNight: true,
  showCameras: false,
  camerasLiveOnly: false,
  showIss: false,
  showAurora: false,
  showShips: false,
  showMilAir: false,
  showAircraft: false,
  showSatellites: false,
  infraLayers: [],
  autoRefresh: true,
  defaultRange: "24h",
  defaultCategories: [...EVENT_CATEGORIES],
  showAI: true,
  developerMode: false,
  watchlist: ["SPY", "QQQ", "AAPL", "NVDA"],
  alerts: [],
};

// Escape hatch: open the app with ?reset to clear saved settings (e.g. too many heavy
// overlays left on for a low-memory machine). Runs before the store rehydrates.
if (typeof window !== "undefined" && new URLSearchParams(window.location.search).has("reset")) {
  try {
    window.localStorage.removeItem("worldview-ui");
    window.history.replaceState(null, "", window.location.pathname);
  } catch {
    /* storage unavailable */
  }
}

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
      selectedTrack: null,
      followTrack: false,
      hoveredEventId: null,
      flyTo: null,
      searchPin: null,
      sidebarCollapsed: false,
      view: "world",
      setView: (view) => set({ view }),
      searchOpen: false,
      briefingOpen: false,
      marketsOpen: false,
      planetOpen: false,
      analystOpen: false,
      energyOpen: false,
      securityOpen: false,
      trendsOpen: false,
      infraOpen: false,
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
      selectEvent: (selectedEventId) => set({ selectedEventId, ...(selectedEventId ? { selectedCountry: null, selectedRegion: null, selectedTrack: null } : {}) }),
      selectCountry: (selectedCountry) => set({ selectedCountry, ...(selectedCountry ? { selectedEventId: null, selectedRegion: null, selectedTrack: null } : {}) }),
      selectRegion: (selectedRegion) => set({ selectedRegion, ...(selectedRegion !== null ? { selectedEventId: null, selectedCountry: null, selectedTrack: null } : {}) }),
      selectTrack: (selectedTrack) =>
        set((s) => ({
          selectedTrack,
          // Following stays on when switching between objects, off when the panel closes.
          followTrack: selectedTrack ? s.followTrack : false,
          ...(selectedTrack ? { selectedEventId: null, selectedCountry: null, selectedRegion: null } : {}),
        })),
      setFollowTrack: (followTrack) => set({ followTrack }),
      setHovered: (hoveredEventId) => set({ hoveredEventId }),
      requestFlyTo: (r) => set({ flyTo: { ...r, nonce: Date.now() + Math.random() } }),
      setSearchPin: (searchPin) => set({ searchPin }),
      setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
      setSearchOpen: (searchOpen) => set({ searchOpen }),
      // Panels are pages now: "open" means go to that page.
      setBriefingOpen: (v) => set(v ? { view: "briefing" } : {}),
      // Panels are pages now: "open" means go to that page.
      setMarketsOpen: (v) => set(v ? { view: "markets" } : {}),
      // Panels are pages now: "open" means go to that page.
      setPlanetOpen: (v) => set(v ? { view: "planet" } : {}),
      // Panels are pages now: "open" means go to that page.
      setAnalystOpen: (v) => set(v ? { view: "analyst" } : {}),
      // Panels are pages now: "open" means go to that page.
      setEnergyOpen: (v) => set(v ? { view: "energy" } : {}),
      // Panels are pages now: "open" means go to that page.
      setSecurityOpen: (v) => set(v ? { view: "security" } : {}),
      // Panels are pages now: "open" means go to that page.
      setTrendsOpen: (v) => set(v ? { view: "trends" } : {}),
      setInfraOpen: (infraOpen) => set({ infraOpen }),
      toggleInfraLayer: (id) =>
        set((s) => {
          const cur = s.settings.infraLayers;
          return { settings: { ...s.settings, infraLayers: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] } };
        }),
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
      partialize: (s) => ({ settings: s.settings, sidebarCollapsed: s.sidebarCollapsed, feedSort: s.feedSort, mapMode: s.mapMode, view: s.view }),
      // Apply default layers/range from saved settings on load.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<UIState>;
        const settings = { ...DEFAULT_SETTINGS, ...(p.settings ?? {}) };
        if (!["mosaic", "live", "daily", "night"].includes(settings.satSource)) settings.satSource = DEFAULT_SETTINGS.satSource;
        if (!["esri", "usgs", "off"].includes(settings.hiresProvider)) settings.hiresProvider = DEFAULT_SETTINGS.hiresProvider;
        settings.infraLayers = Array.isArray(settings.infraLayers)
          ? settings.infraLayers.filter((id) => (INFRA_LAYER_IDS as readonly string[]).includes(id))
          : [];
        const valid = settings.defaultCategories.filter((c) => (EVENT_CATEGORIES as readonly string[]).includes(c));
        const mapMode = (MAP_MODE_IDS as readonly string[]).includes(String(p.mapMode)) ? p.mapMode! : "events";
        const view = (APP_VIEWS as readonly string[]).includes(String(p.view)) ? p.view! : "world";
        return {
          ...current,
          ...p,
          view,
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
