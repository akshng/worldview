"use client";
/**
 * Interactive 3D globe (MapLibre GL globe projection).
 * Rendering is fully WebGL: clustering, points, heatmap and country hit-testing
 * happen in map layers — never as DOM markers.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { GeoJSONSource, Map as MlMap, MapGeoJSONFeature, PointLike, Popup } from "maplibre-gl";
import { getMaplibre } from "./maplibre";
import { basemapVisibility, buildStyle, IMAGERY_TOP, labelLayers } from "./style";
import { ImageryPanel } from "./ImageryPanel";
import { desiredRasters, gibsTileUrl, maxZoomFor, rasterId, rasterSlot } from "@/lib/imagery";
import { useImageryTimes } from "@/lib/client/use-imagery-times";
import {
  AIRCRAFT_SOURCE,
  ALL_MODE_LAYERS,
  AREAS_SOURCE,
  areaCollection,
  COUNTRIES_SOURCE,
  DENSITY_SOURCE,
  EVENT_POINT_LAYERS,
  EVENTS_SOURCE,
  FLAT_SOURCE,
  MODE_LAYERS,
  NIGHT_SOURCE,
  VESSELS_SOURCE,
  arrowImage,
  countryLayers,
  densityGrid,
  eventLayers,
  liveLayers,
  modeLayers,
  nightLayer,
  toFeatureCollection,
  CAMERAS_SOURCE,
  CAMERA_COLOR,
  CAMERA_LIVE_COLOR,
  cameraLayers,
  REGIONS_SOURCE,
  regionLayers,
  AURORA_LAYER_IDS,
  AURORA_SOURCE,
  AURORA_STOPS,
  ISS_COLOR,
  ISS_LAYER_IDS,
  ISS_SOURCE,
  ISS_TRACK_SOURCE,
  auroraLayers,
  issLayers,
  SEARCH_PIN_SOURCE,
  searchPinCollection,
  searchPinLayers,
  MIL_COLOR,
  MIL_LAYER_IDS,
  MIL_SOURCE,
  milLayers,
  SAT_COLORS,
  SAT_LAYER_IDS,
  SAT_SOURCE,
  SAT_TRACK_SOURCE,
  satelliteLayers,
  AIR_SOURCE,
  AIR_LAYER_IDS,
  aircraftLiveLayers,
  planeImage,
  TRACK_HL_SOURCE,
  trackHighlightLayers,
  SHIP_COVERAGE_SOURCE,
  shipCoverageCollection,
  shipCoverageLayers,
} from "./layers";
import { aircraftFeatures, highlightFeatures, milFeatures, prepareSats, satFeatures, satTrackFeatures, trackPosition, vesselFeatures } from "./tracking";
import { useTracking } from "@/lib/client/tracking-store";
import type { AircraftData, AirRow } from "@/layers/aircraft/parser";
import type { TrackRef } from "@/lib/store/ui";
import { TrackingLegend } from "./TrackingLegend";
import { LegendCard } from "./LegendCard";
import type { MilitaryAircraftData } from "@/layers/military-aircraft/parser";
import type { SatellitesData } from "@/layers/satellites/parser";
import { navStatusLabel } from "@/layers/maritime/parser";
import { INFRA_INTERACTIVE, INFRA_LAYER_OF, INFRA_MAP_LAYERS, infraLayers, infraSource } from "./infra-layers";
import { InfraPanel } from "./InfraPanel";
import { INFRA_DATASETS, INFRA_LAYER_BY_ID, INFRA_LAYER_IDS, fuelColor, PIPELINE_COLORS } from "@/lib/infra/catalog";
import { CHOKEPOINTS, chokepointFeatures, LEVEL_COLORS, type ChokepointStatus } from "@/lib/infra/chokepoints";
import { loadInfraFile, useChokepointMonitor, useInfra } from "@/lib/client/infra";
import { issFeatures, type IssData } from "@/layers/iss";
import { auroraFeatures, type AuroraData } from "@/layers/aurora";
import type { LiveLayerResponse } from "@/lib/client/use-live-layer";
import type { AviationData } from "@/layers/aviation/types";
import type { MaritimeData } from "@/layers/maritime/types";
import type { RadarData } from "@/layers/weather-radar";
import { nightCollection } from "./terminator";
import { useUI } from "@/lib/store/ui";
import { useLiveLayer } from "@/lib/client/use-live-layer";
import type { CamerasData } from "@/layers/cameras";
import { hasLive } from "@/lib/cameras";
import { CameraViewer } from "@/components/cameras/CameraViewer";
import { LayersIcon } from "@/components/ui/icons";
import { loadRegions, REGION_ZOOM } from "@/lib/client/regions";
import { useData } from "@/lib/client/data-store";
import { CATEGORIES } from "@/lib/categories";
import { relativeTime } from "@/lib/time";
import type { EventCategory } from "@/types/events";

export const HOME_VIEW = { center: [-30, 26] as [number, number], zoom: 2.05 };

const EMPTY_FC: GeoJSON.FeatureCollection = {
  type: "FeatureCollection",
  features: [],
};

/** Clickable live-tracking layers → the object they open in the track panel. */
function trackRefOf(f: MapGeoJSONFeature): TrackRef | null {
  const p = f.properties as Record<string, unknown>;
  switch (f.layer.id) {
    case "vessels":
      return { kind: "ship", id: String(p.mmsi) };
    case "air":
      return { kind: "aircraft", id: String(p.hex) };
    case "mil-aircraft":
      return { kind: "aircraft", id: String(p.hex), mil: true };
    case "aircraft":
      return { kind: "aircraft", id: String(p.icao24) };
    case "sat-point":
      return { kind: "sat", id: String(p.id) };
    default:
      return null;
  }
}

/** Response of GET /api/ships */
interface ViewportShipsResponse {
  observedAt: string;
  count: number;
  data: MaritimeData;
  truncated: boolean;
  pending: number;
  keyed: boolean;
  errors: string[];
  attribution: string;
}

/**
 * Polls a bbox endpoint (/api/aircraft, /api/ships) for the current map view
 * while `on`: on a timer, after pan/zoom (debounced) and again shortly when the
 * server reports cells still loading.
 */
function useViewportFeed<T extends { pending?: number }>(path: string, on: boolean, map: MlMap | null, pollMs: number) {
  const [st, setSt] = useState<{
    key: string;
    data: T | null;
    error: string | null;
    loading: boolean;
  }>({ key: "", data: null, error: null, loading: false });
  const key = on && map ? path : "";
  useEffect(() => {
    if (!on || !map) return;
    let ctrl: AbortController | null = null;
    let debounce: ReturnType<typeof setTimeout> | undefined;
    let again: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      if (document.hidden) return;
      ctrl?.abort();
      clearTimeout(again);
      const c = (ctrl = new AbortController());
      setSt((s) => ({ ...s, key: path, loading: true }));
      try {
        const res = await fetch(`${path}?bbox=${viewBbox(map).join(",")}`, {
          signal: c.signal,
          cache: "no-store",
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
        setSt({ key: path, data: body as T, error: null, loading: false });
        // Some cells were still loading upstream: ask again soon for the rest.
        if (((body as T).pending ?? 0) > 0) again = setTimeout(load, 2_500);
      } catch (e) {
        if ((e as Error).name !== "AbortError")
          setSt((s) => ({
            ...s,
            key: path,
            error: (e as Error).message,
            loading: false,
          }));
      }
    };
    const onMove = () => {
      clearTimeout(debounce);
      debounce = setTimeout(load, 450);
    };
    void load();
    const t = setInterval(load, pollMs);
    map.on("moveend", onMove);
    document.addEventListener("visibilitychange", load);
    return () => {
      ctrl?.abort();
      clearTimeout(debounce);
      clearTimeout(again);
      clearInterval(t);
      map.off("moveend", onMove);
      document.removeEventListener("visibilitychange", load);
    };
  }, [path, on, map, pollMs]);
  return st.key === key && key ? st : { key, data: null, error: null, loading: !!key };
}

/** Response of GET /api/aircraft */
interface ViewportAircraftResponse {
  observedAt: string;
  count: number;
  data: AircraftData;
  cells: Array<[number, number, number, number]>;
  truncated: boolean;
  capped: boolean;
  pending: number;
  errors: string[];
  attribution: string;
}

/** Map view → [west, south, east, north] for /api/aircraft (east < west across the antimeridian). */
function viewBbox(map: MlMap): [number, number, number, number] {
  const b = map.getBounds();
  let w = b.getWest(),
    e = b.getEast();
  const s = Math.max(-85, b.getSouth()),
    n = Math.min(85, b.getNorth());
  if (e - w >= 360) [w, e] = [-180, 180];
  const wrap = (x: number) => ((((x + 180) % 360) + 360) % 360) - 180;
  if (w !== -180 || e !== 180) [w, e] = [wrap(w), wrap(e)];
  return [w, s, e, n].map((v) => Math.round(v * 100) / 100) as [number, number, number, number];
}

interface GlobeProps {
  window: { from: number; to: number };
  /** Snapshot of the live layer for the current mode, if any */
  live: LiveLayerResponse<unknown> | null;
}

export default function Globe({ window: win, live }: GlobeProps) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const popupRef = useRef<Popup | null>(null);
  const listPopupRef = useRef<Popup | null>(null);
  const hoveredCountry = useRef<number | null>(null);
  const selectedCountryFid = useRef<number | null>(null);
  const countryIds = useRef(new Map<string, number>());
  const areaIds = useRef(new Map<string, number>());
  const selectedAreaFid = useRef<number | null>(null);
  const [ready, setReady] = useState(false);
  /** The loaded map as state, for hooks that need it during render. */
  const [mapObj, setMapObj] = useState<MlMap | null>(null);
  const [countriesLoaded, setCountriesLoaded] = useState(false);
  const marketByCountry = useRef(new Map<string, { name: string; changePct: number }>());
  /** The map instance whose style finished loading (guards StrictMode/HMR remounts). */
  const loadedMap = useRef<MlMap | null>(null);
  const liveMap = () => (mapRef.current && loadedMap.current === mapRef.current ? mapRef.current : null);
  const [mapError, setMapError] = useState<string | null>(null);
  const camerasRef = useRef<CamerasData | null>(null);
  const hoveredRegion = useRef<number | null>(null);
  const selectedRegionFid = useRef<number | null>(null);
  const selectedRegion = useUI((s) => s.selectedRegion);

  const visible = useData((s) => s.visible);
  const mapStyle = useUI((s) => s.settings.mapStyle);
  const showLabels = useUI((s) => s.settings.showEventLabels);
  const showDayNight = useUI((s) => s.settings.showDayNight);
  const mapMode = useUI((s) => s.mapMode);
  const selectedEventId = useUI((s) => s.selectedEventId);
  const selectedCountry = useUI((s) => s.selectedCountry);
  const hoveredEventId = useUI((s) => s.hoveredEventId);
  const flyTo = useUI((s) => s.flyTo);
  const searchPin = useUI((s) => s.searchPin);
  const radarFrame = useUI((s) => s.radarFrame);
  const radarPlaying = useUI((s) => s.radarPlaying);
  const showCameras = useUI((s) => s.settings.showCameras);
  const cameras = useLiveLayer<CamerasData>(showCameras ? "cameras" : null, 30 * 60_000);
  const camerasLiveOnly = useUI((s) => s.settings.camerasLiveOnly);
  const showIss = useUI((s) => s.settings.showIss);
  const showAurora = useUI((s) => s.settings.showAurora);
  const iss = useLiveLayer<IssData>(showIss ? "iss" : null, 5_000, {
    pauseWhenHidden: true,
  });
  const aurora = useLiveLayer<AuroraData>(showAurora ? "aurora" : null, 10 * 60_000, { pauseWhenHidden: true });
  const auroraRef = useRef<AuroraData | null>(null);
  // Live tracking overlays: each fetches only while toggled on and the tab is visible.
  const showShips = useUI((s) => s.settings.showShips);
  const showMilAir = useUI((s) => s.settings.showMilAir);
  const showSatellites = useUI((s) => s.settings.showSatellites);
  // In Maritime mode the mode already polls the same (server-cached) layer.
  const mil = useLiveLayer<MilitaryAircraftData>(showMilAir ? "military-aircraft" : null, 30_000, { pauseWhenHidden: true });
  const sats = useLiveLayer<SatellitesData>(showSatellites ? "satellites" : null, 30 * 60_000, { pauseWhenHidden: true });
  const selectedTrack = useUI((s) => s.selectedTrack);
  const followTrack = useUI((s) => s.followTrack);
  const selectedSat = selectedTrack?.kind === "sat" ? Number(selectedTrack.id) : null;
  const setSelectedSat = (id: number | null) => useUI.getState().selectTrack(id === null ? null : { kind: "sat", id: String(id) });
  const showAircraft = useUI((s) => s.settings.showAircraft);
  // Viewport feeds: refetched on pan/zoom and on a timer while switched on.
  const air = useViewportFeed<ViewportAircraftResponse>("/api/aircraft", showAircraft, ready ? mapObj : null, 15_000);
  const shipsVp = useViewportFeed<ViewportShipsResponse>("/api/ships", showShips && mapMode !== "maritime", ready ? mapObj : null, 30_000);
  const ships = {
    data: shipsVp.data,
    error: shipsVp.error,
    loading: shipsVp.loading,
  };
  const [layersOpen, setLayersOpen] = useState(false);
  /** Selected / hovered tracked-object positions and the trail, drawn by drawHighlight(). */
  const hl = useRef<{
    selected: { lon: number; lat: number } | null;
    hover: { lon: number; lat: number } | null;
  }>({ selected: null, hover: null });
  const drawHighlight = (map: MlMap) =>
    (map.getSource(TRACK_HL_SOURCE) as GeoJSONSource | undefined)?.setData(
      highlightFeatures(hl.current.selected, hl.current.hover, hl.current.selected ? useTracking.getState().trail : []),
    );
  const infraOn = useUI((s) => s.settings.infraLayers);
  const infraOpen = useUI((s) => s.infraOpen);
  const chokepointsOn = infraOn.includes("chokepoints");
  useChokepointMonitor(chokepointsOn || infraOpen);
  const monitor = useInfra((s) => s.monitor);
  const monitorRef = useRef<Map<string, ChokepointStatus>>(new Map());
  const wantIdsRef = useRef<Set<string>>(new Set());
  const satSource = useUI((s) => s.settings.satSource);
  const hiresProvider = useUI((s) => s.settings.hiresProvider);
  const satLabels = useUI((s) => s.settings.satLabels);
  const showClouds = useUI((s) => s.settings.showClouds);
  const needsTimes = (mapStyle === "satellite" && satSource !== "mosaic") || showClouds;
  const imagery = useImageryTimes(needsTimes);
  /** Current view (updated on moveend) for the imagery label. */
  const [view, setView] = useState({
    zoom: HOME_VIEW.zoom,
    lon: HOME_VIEW.center[0],
  });

  // Legends sit where the detail panels open: hide them while one is open.
  const sidePanelOpen = useUI((s) => !!(s.selectedEventId || s.selectedCountry || s.selectedRegion !== null || s.selectedTrack));
  const activeOverlays =
    [showShips, showAircraft, showMilAir, showSatellites, showIss, showAurora, showCameras].filter(Boolean).length + (infraOn.length ? 1 : 0);

  // ---- init -------------------------------------------------------------
  useEffect(() => {
    if (!container.current) return;
    const maplibregl = getMaplibre();
    const initial = useUI.getState().settings;
    let map: MlMap;
    try {
      map = new maplibregl.Map({
        container: container.current,
        style: buildStyle(initial.mapStyle, {
          hires: initial.hiresProvider,
          hybrid: initial.satLabels,
        }),
        center: HOME_VIEW.center,
        zoom: HOME_VIEW.zoom,
        minZoom: 0.6,
        // Deep zoom (to 18–19) where satellite imagery exists; street level (17) on vector maps for place search.
        maxZoom: maxZoomFor(initial.mapStyle, initial.hiresProvider),
        attributionControl: { compact: true },
        renderWorldCopies: false,
        maxPitch: 60,
      });
    } catch (err) {
      // Reporting a failure of the external WebGL system is a legitimate effect-driven update.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMapError(err instanceof Error ? err.message : "WebGL is not available");
      return;
    }
    mapRef.current = map;
    popupRef.current = new maplibregl.Popup({
      closeButton: false,
      closeOnClick: false,
      offset: 12,
      maxWidth: "280px",
    });

    map.on("moveend", () => setView({ zoom: map.getZoom(), lon: map.getCenter().lng }));
    // Dragging the map takes over from "follow".
    map.on("dragstart", () => {
      if (useUI.getState().followTrack) useUI.getState().setFollowTrack(false);
    });
    if (new URLSearchParams(window.location.search).has("debugmap")) (window as unknown as { __wvMap?: MlMap }).__wvMap = map;

    map.on("error", (e) => {
      // Tile/network errors are non-fatal; log once for developers.
      if (e?.error?.message) console.debug("[globe]", e.error.message);
    });

    map.on("load", () => {
      map.addSource(NIGHT_SOURCE, {
        type: "geojson",
        data: nightCollection(new Date()),
      });
      map.addLayer(nightLayer());

      map.addSource(COUNTRIES_SOURCE, {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      for (const l of countryLayers()) map.addLayer(l);
      map.addSource(AURORA_SOURCE, { type: "geojson", data: EMPTY_FC });
      for (const l of auroraLayers()) map.addLayer(l);
      map.addSource(REGIONS_SOURCE, { type: "geojson", data: EMPTY_FC });
      for (const l of regionLayers(REGION_ZOOM)) map.addLayer(l);
      // States/provinces load the first time the map is zoomed in far enough.
      let regionsRequested = false;
      const maybeLoadRegions = () => {
        if (regionsRequested || map.getZoom() < REGION_ZOOM - 0.4) return;
        regionsRequested = true;
        loadRegions()
          .then((fc) => (map.getSource(REGIONS_SOURCE) as GeoJSONSource | undefined)?.setData(fc as unknown as GeoJSON.FeatureCollection))
          .catch(() => {
            regionsRequested = false;
          });
      };
      map.on("zoomend", maybeLoadRegions);
      maybeLoadRegions();

      // Strategic infrastructure: empty until a layer is switched on; below events.
      for (const id of INFRA_LAYER_IDS) {
        const src = infraSource(id);
        if (map.getSource(src)) continue;
        const attribution = INFRA_LAYER_BY_ID[id].sources.map((d) => INFRA_DATASETS[d].attribution).join(" · ");
        map.addSource(src, {
          type: "geojson",
          data: EMPTY_FC,
          attribution: id === "chokepoints" ? undefined : attribution,
        });
      }
      for (const l of infraLayers()) map.addLayer(l);

      map.addSource(EVENTS_SOURCE, {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
        cluster: true,
        clusterRadius: 42,
        // High max zoom keeps events that share a point grouped; clicking such a
        // cluster at high zoom opens a pick-list instead of overlapping markers.
        clusterMaxZoom: 14,
        clusterProperties: { maxImp: ["max", ["get", "imp"]] },
      });
      map.addSource(FLAT_SOURCE, { type: "geojson", data: EMPTY_FC });
      map.addSource(AREAS_SOURCE, { type: "geojson", data: EMPTY_FC });
      map.addSource(DENSITY_SOURCE, { type: "geojson", data: EMPTY_FC });
      map.addSource(AIRCRAFT_SOURCE, { type: "geojson", data: EMPTY_FC });
      map.addSource(VESSELS_SOURCE, { type: "geojson", data: EMPTY_FC });
      if (!map.hasImage("arrow")) map.addImage("arrow", arrowImage(), { sdf: true });
      for (const l of modeLayers()) map.addLayer(l);
      for (const l of eventLayers()) map.addLayer(l);
      for (const l of liveLayers()) map.addLayer(l);
      map.addSource(CAMERAS_SOURCE, {
        type: "geojson",
        data: EMPTY_FC,
        cluster: true,
        clusterRadius: 38,
        clusterMaxZoom: 11,
      });
      for (const l of cameraLayers()) map.addLayer(l);
      map.addSource(ISS_TRACK_SOURCE, { type: "geojson", data: EMPTY_FC });
      map.addSource(ISS_SOURCE, { type: "geojson", data: EMPTY_FC });
      for (const l of issLayers()) map.addLayer(l);
      if (!map.hasImage("plane")) map.addImage("plane", planeImage(), { sdf: true });
      map.addSource(SHIP_COVERAGE_SOURCE, { type: "geojson", data: EMPTY_FC });
      for (const l of shipCoverageLayers()) map.addLayer(l);
      map.addSource(AIR_SOURCE, {
        type: "geojson",
        data: EMPTY_FC,
        attribution: "Aircraft: adsb.lol (ODbL)",
      });
      for (const l of aircraftLiveLayers()) map.addLayer(l);
      map.addSource(MIL_SOURCE, { type: "geojson", data: EMPTY_FC });
      for (const l of milLayers()) map.addLayer(l);
      map.addSource(SAT_TRACK_SOURCE, { type: "geojson", data: EMPTY_FC });
      map.addSource(SAT_SOURCE, { type: "geojson", data: EMPTY_FC });
      for (const l of satelliteLayers()) map.addLayer(l);
      map.addSource(TRACK_HL_SOURCE, { type: "geojson", data: EMPTY_FC });
      for (const l of trackHighlightLayers()) map.addLayer(l);
      for (const l of labelLayers()) map.addLayer(l);
      map.addSource(SEARCH_PIN_SOURCE, {
        type: "geojson",
        data: searchPinCollection(useUI.getState().searchPin),
      });
      for (const l of searchPinLayers()) map.addLayer(l);

      // Country polygons are large; load after first paint.
      fetch("/geo/countries.geojson")
        .then((r) => r.json())
        .then((fc: GeoJSON.FeatureCollection) => {
          for (const f of fc.features) countryIds.current.set(String(f.properties?.code), Number(f.id));
          (map.getSource(COUNTRIES_SOURCE) as GeoJSONSource | undefined)?.setData(fc);
          setCountriesLoaded(true);
        })
        .catch(() => {});

      loadedMap.current = map;
      setMapObj(map);
      setReady(true);
    });

    // ---- interactions ---------------------------------------------------
    const popupLines = (coords: [number, number], head: { text: string; color: string }, title: string, sub?: string) => {
      const el = document.createElement("div");
      const h = document.createElement("div");
      h.className = "meta";
      h.style.color = head.color;
      h.textContent = head.text;
      const t = document.createElement("div");
      t.style.cssText = "font-size:12.5px;font-weight:500;line-height:1.35;margin-top:3px";
      t.textContent = title;
      el.append(h, t);
      if (sub) {
        const d = document.createElement("div");
        d.className = "meta";
        d.style.cssText = "color:var(--text-muted);margin-top:5px;text-transform:none;letter-spacing:0.02em";
        d.textContent = sub;
        el.append(d);
      }
      popupRef.current?.setLngLat(coords).setDOMContent(el).addTo(map);
    };

    const showPopup = (f: MapGeoJSONFeature) => {
      const coords = (f.geometry.type === "Point" ? f.geometry.coordinates : [0, 0]) as [number, number];
      const p = f.properties as Record<string, unknown>;
      if (f.layer.id === "aircraft") {
        const alt = typeof p.alt === "number" ? `${Math.round(p.alt).toLocaleString("en-US")} m` : "altitude n/a";
        const spd = typeof p.speed === "number" ? `${Math.round(p.speed * 1.944)} kt` : "speed n/a";
        return popupLines(
          coords,
          { text: "Aircraft · click for details", color: "#4dabf7" },
          String(p.callsign || p.icao24),
          [p.country, p.onGround ? "on ground" : alt, spd].filter(Boolean).join(" · "),
        );
      }
      if (f.layer.id === "air") {
        const alt = p.onGround ? "on ground" : typeof p.alt === "number" ? `${Math.round(p.alt).toLocaleString("en-US")} ft` : "altitude n/a";
        const gs = typeof p.gs === "number" ? `${p.gs} kt` : null;
        return popupLines(
          coords,
          {
            text: p.mil ? "Military-flagged aircraft · click for details" : "Aircraft · click for details",
            color: p.mil ? MIL_COLOR : "#4dabf7",
          },
          String(p.callsign || p.reg || String(p.hex).toUpperCase()),
          [p.type || null, alt, gs, p.reg && p.callsign ? String(p.reg) : null].filter(Boolean).join(" · "),
        );
      }
      if (f.layer.id === "vessels") {
        const sog = typeof p.sog === "number" ? `${p.sog} kn` : "speed n/a";
        const hdg = typeof p.heading === "number" ? `${Math.round(p.heading)}°` : null;
        const cat = p.cat && p.cat !== "other" ? String(p.cat) : null;
        const nav = navStatusLabel(typeof p.nav === "number" ? p.nav : null);
        return popupLines(
          coords,
          {
            text: `${cat ? `Vessel · ${cat}` : "Vessel"} · click for details`,
            color: "#4dd4ff",
          },
          String(p.name || `MMSI ${p.mmsi}`),
          [`MMSI ${p.mmsi}`, sog, hdg, nav, p.dest ? `→ ${p.dest}` : null].filter(Boolean).join(" · "),
        );
      }
      if (f.layer.id === "mil-aircraft") {
        const alt = p.onGround ? "on ground" : typeof p.alt === "number" ? `${Math.round(p.alt).toLocaleString("en-US")} ft` : "altitude n/a";
        const gs = typeof p.gs === "number" ? `${p.gs} kt` : null;
        return popupLines(
          coords,
          {
            text: "Military-flagged aircraft · click for details",
            color: MIL_COLOR,
          },
          String(p.callsign || p.reg || p.hex),
          [p.type || "type n/a", alt, gs, p.reg && p.callsign ? String(p.reg) : null, `hex ${p.hex}`].filter(Boolean).join(" · "),
        );
      }
      if (f.layer.id === "sat-point") {
        const group = p.group === "stations" ? "Space station" : p.group === "gps" ? "GPS satellite" : "Satellite";
        return popupLines(
          coords,
          {
            text: `${group} · click for orbit & details`,
            color: SAT_COLORS[p.group as keyof typeof SAT_COLORS] ?? SAT_COLORS.visual,
          },
          String(p.name),
          `${Number(p.altKm).toLocaleString("en-US")} km · ${p.speedKms} km/s · period ${p.periodMin} min · NORAD ${p.id}`,
        );
      }
      if (f.layer.id === "cam-point") {
        return p.live
          ? popupLines(coords, { text: "Live video", color: CAMERA_LIVE_COLOR }, String(p.name), `${p.sourceName} · click to watch`)
          : popupLines(coords, { text: "Camera · still image", color: CAMERA_COLOR }, String(p.name), `${p.sourceName} · click to view`);
      }
      if (f.layer.id === "cam-cluster") {
        return popupLines(coords, { text: "Cameras", color: CAMERA_COLOR }, `${p.point_count} public cameras`, "Click to zoom in");
      }
      if (f.layer.id === "iss-point") {
        const sunlit = p.visibility === "daylight" ? "station in sunlight" : p.visibility === "eclipsed" ? "station in Earth's shadow" : null;
        const ground = p.groundDaylight === true ? "daytime below" : p.groundDaylight === false ? "night below" : null;
        return popupLines(
          coords,
          { text: "International Space Station", color: ISS_COLOR },
          `${Math.round(Number(p.altKm))} km altitude · ${Math.round(Number(p.speedKmh)).toLocaleString("en-US")} km/h`,
          [sunlit, ground, `computed from orbital elements · ${relativeTime(String(p.time))}`].filter(Boolean).join(" · "),
        );
      }
      if (f.layer.id === "aurora") {
        const a = auroraRef.current;
        const at = a?.forecastTime ? new Date(a.forecastTime).toISOString().slice(11, 16) + " UTC" : "time n/a";
        return popupLines(coords, { text: "Aurora forecast", color: "#2fbf71" }, `${p.p}% chance of visible aurora`, `NOAA OVATION model forecast for ${at}`);
      }
      const infraId = INFRA_LAYER_OF[f.layer.id];
      if (infraId) {
        const s = (v: unknown) => (v === undefined || v === null || v === "" ? null : String(v));
        const sub = (...parts: unknown[]) => parts.map(s).filter(Boolean).join(" · ");
        const color = INFRA_LAYER_BY_ID[infraId].color;
        switch (infraId) {
          case "cables":
            return popupLines(
              coords,
              { text: "Subsea telecom cable", color },
              s(p.n) ?? "Unnamed submarine cable",
              sub(p.op, p.km ? `${p.km} km mapped` : null, "OpenStreetMap"),
            );
          case "landing": {
            const raw = p.cables;
            const cables = Array.isArray(raw) ? raw : typeof raw === "string" && raw.startsWith("[") ? (JSON.parse(raw) as string[]) : [];
            return popupLines(
              coords,
              {
                text: p.k === "station" ? "Cable landing station" : "Cable landing point",
                color,
              },
              s(p.n) ?? (cables.length ? cables.slice(0, 3).join(", ") : "Submarine cable landing"),
              sub(p.k === "station" ? "mapped landing station" : "cable end at the coast", "OpenStreetMap"),
            );
          }
          case "power":
          case "nuclear":
            return popupLines(
              coords,
              {
                text: `${s(p.f) ?? "Power"} power plant`,
                color: fuelColor(String(p.f)),
              },
              s(p.n) ?? "Power plant",
              sub(`${Number(p.mw).toLocaleString("en-US")} MW`, p.c, p.y ? `commissioned ${p.y}` : null, "WRI GPPD"),
            );
          case "pipelines":
            return popupLines(
              coords,
              {
                text: `${p.s === "products" ? "Refined-products" : p.s === "gas" ? "Gas" : p.s === "oil" ? "Oil" : "Oil/gas"} pipeline`,
                color: PIPELINE_COLORS[String(p.s)] ?? color,
              },
              s(p.n) ?? "Unnamed pipeline",
              sub(p.op, p.km ? `${Number(p.km).toLocaleString("en-US")} km mapped` : null, "OpenStreetMap"),
            );
          case "lng":
            return popupLines(
              coords,
              { text: "LNG terminal", color },
              s(p.n) ?? "LNG site",
              sub(p.c, p.src === "wpi" ? "World Port Index (LNG terminal facility)" : "OpenStreetMap"),
            );
          case "ports": {
            const size = (
              {
                L: "large harbour",
                M: "medium harbour",
                S: "small harbour",
                V: "very small harbour",
              } as Record<string, string>
            )[String(p.s)];
            return popupLines(
              coords,
              { text: "Port", color },
              s(p.n) ?? "Port",
              sub(p.c, size, p.loc, p.oil ? "oil terminal" : null, p.lng ? "LNG terminal" : null, "NGA WPI"),
            );
          }
          case "datacenters":
            return popupLines(coords, { text: "Data centre", color }, s(p.n) ?? "Unnamed data centre", sub(p.op, "OpenStreetMap"));
          case "bases":
            return popupLines(
              coords,
              {
                text: p.k === "naval_base" ? "Naval base" : "Military base",
                color,
              },
              s(p.n) ?? "Unnamed military site",
              sub(p.op, "as mapped in OpenStreetMap"),
            );
          case "chokepoints": {
            const st = monitorRef.current.get(String(p.id));
            return popupLines(
              coords,
              {
                text: "Maritime chokepoint",
                color: st ? LEVEL_COLORS[st.level] : color,
              },
              String(p.name),
              sub(
                p.connects,
                st ? `${st.total} event${st.total === 1 ? "" : "s"} within ${st.radiusKm} km in 7 days` : null,
                st ? `disruption ${st.score}/100` : null,
              ),
            );
          }
        }
      }
      if (f.layer.id === "density-fill") {
        // Polygon cell: caller re-anchors the popup at the cursor.
        return popupLines(
          coords,
          { text: "Density", color: "#2f9bbf" },
          `${p.count} event${p.count === 1 ? "" : "s"} in this cell`,
          `Highest importance ${p.maxImp}`,
        );
      }
      const ev = useData.getState().visible.find((e) => e.id === p.id);
      const cat = CATEGORIES[p.type as EventCategory];
      popupLines(
        coords,
        { text: cat?.label ?? String(p.type), color: cat?.color ?? "#aaa" },
        ev?.title ?? String(p.title),
        ev
          ? [ev.countryName ?? ev.locationName, relativeTime(ev.timestamp), `${ev.sourceCount} source${ev.sourceCount === 1 ? "" : "s"}`]
              .filter(Boolean)
              .join(" · ")
          : undefined,
      );
    };

    const INTERACTIVE = [
      ...EVENT_POINT_LAYERS,
      "ev-cluster",
      "cam-point",
      "cam-cluster",
      "aircraft",
      "air",
      "vessels",
      "mil-aircraft",
      "sat-point",
      "iss-point",
      "density-fill",
      "aurora",
      ...INFRA_INTERACTIVE,
    ];
    const HIT_PX = 9;
    /**
     * Topmost feature under the cursor. Point markers get a forgiving hit area: if
     * nothing point-like is exactly under the cursor, the nearest marker within
     * HIT_PX pixels wins (small arrows and dots are otherwise hard to click).
     */
    const hitAt = (pt: { x: number; y: number }): MapGeoJSONFeature | undefined => {
      const layers = INTERACTIVE.filter((l) => map.getLayer(l));
      const exact = map.queryRenderedFeatures([pt.x, pt.y] as PointLike, {
        layers,
      });
      const exactPoint = exact.find((f) => f.geometry.type === "Point");
      if (exactPoint) return exactPoint;
      const near = map
        .queryRenderedFeatures(
          [
            [pt.x - HIT_PX, pt.y - HIT_PX],
            [pt.x + HIT_PX, pt.y + HIT_PX],
          ] as [PointLike, PointLike],
          { layers },
        )
        .filter((f) => f.geometry.type === "Point");
      let best: MapGeoJSONFeature | undefined;
      let bestD = Infinity;
      for (const f of near) {
        const c = map.project((f.geometry as GeoJSON.Point).coordinates as [number, number]);
        const d = Math.hypot(c.x - pt.x, c.y - pt.y);
        if (d < bestD) [best, bestD] = [f, d];
      }
      return best ?? exact[0];
    };

    map.on("mousemove", (e) => {
      const top = hitAt(e.point);
      map.getCanvas().style.cursor = top ? "pointer" : "";
      if (top && top.layer.id !== "ev-cluster") {
        showPopup(top);
        // Areas and lines (density cells, aurora, cables, pipelines, chokepoint radii): anchor at the cursor.
        if (top.geometry.type !== "Point") popupRef.current?.setLngLat(e.lngLat);
      } else {
        popupRef.current?.remove();
      }
      const hoverPos = top && trackRefOf(top) && top.geometry.type === "Point" ? (top.geometry.coordinates as [number, number]) : null;
      const prevHover = hl.current.hover;
      if (hoverPos?.[0] !== prevHover?.lon || hoverPos?.[1] !== prevHover?.lat) {
        hl.current.hover = hoverPos ? { lon: hoverPos[0], lat: hoverPos[1] } : null;
        drawHighlight(map);
      }
      const hoveredEvent = top && EVENT_POINT_LAYERS.includes(top.layer.id) ? String(top.properties.id) : null;
      if (useUI.getState().hoveredEventId !== hoveredEvent) useUI.getState().setHovered(hoveredEvent);
      // Zoomed in (outside markets mode), states/provinces take over from countries.
      const regionMode = map.getZoom() >= REGION_ZOOM && useUI.getState().mapMode !== "markets";
      const region = top || !regionMode || !map.getLayer("region-fill") ? undefined : map.queryRenderedFeatures(e.point, { layers: ["region-fill"] })[0];
      const rid = region?.id !== undefined ? Number(region.id) : null;
      if (rid !== hoveredRegion.current) {
        if (hoveredRegion.current !== null) map.setFeatureState({ source: REGIONS_SOURCE, id: hoveredRegion.current }, { hover: false });
        if (rid !== null) map.setFeatureState({ source: REGIONS_SOURCE, id: rid }, { hover: true });
        hoveredRegion.current = rid;
      }
      if (region && !top) {
        const rp = region.properties as {
          name?: string;
          type?: string;
          countryName?: string;
        };
        map.getCanvas().style.cursor = "pointer";
        popupLines([e.lngLat.lng, e.lngLat.lat], { text: rp.type ?? "Region", color: "#9cc9ff" }, String(rp.name ?? ""), String(rp.countryName ?? ""));
      }
      // Country hover
      const country =
        top || regionMode
          ? undefined
          : map.queryRenderedFeatures(e.point, {
              layers: map.getLayer("country-fill") ? ["country-fill"] : [],
            })[0];
      const idx = country && useUI.getState().mapMode === "markets" ? marketByCountry.current.get(String(country.properties?.code)) : undefined;
      if (idx) {
        const up = idx.changePct >= 0;
        popupLines(
          [e.lngLat.lng, e.lngLat.lat],
          {
            text: String(country!.properties?.name ?? ""),
            color: up ? "#3f8de8" : "#e5534b",
          },
          `${idx.name} ${up ? "▲" : "▼"} ${up ? "+" : ""}${idx.changePct.toFixed(2)}%`,
          "Daily change vs previous close (delayed)",
        );
      }
      const fid = country?.id !== undefined ? Number(country.id) : null;
      if (fid !== null && !top) map.getCanvas().style.cursor = "pointer";
      if (fid !== hoveredCountry.current) {
        if (hoveredCountry.current !== null) map.setFeatureState({ source: COUNTRIES_SOURCE, id: hoveredCountry.current }, { hover: false });
        if (fid !== null) map.setFeatureState({ source: COUNTRIES_SOURCE, id: fid }, { hover: true });
        hoveredCountry.current = fid;
      }
    });
    map.on("mouseout", () => {
      popupRef.current?.remove();
      if (hl.current.hover) {
        hl.current.hover = null;
        drawHighlight(map);
      }
      if (hoveredCountry.current !== null) map.setFeatureState({ source: COUNTRIES_SOURCE, id: hoveredCountry.current }, { hover: false });
      hoveredCountry.current = null;
      if (hoveredRegion.current !== null) map.setFeatureState({ source: REGIONS_SOURCE, id: hoveredRegion.current }, { hover: false });
      hoveredRegion.current = null;
    });

    map.on("click", async (e) => {
      const top = hitAt(e.point);
      // The aurora overlay and infrastructure lines/areas are hover-only; clicks pass through to countries/regions.
      const hoverOnly = top && (top.layer.id === "aurora" || (INFRA_LAYER_OF[top.layer.id] && top.geometry.type !== "Point"));
      const hit = hoverOnly ? undefined : top;
      const ui = useUI.getState();
      if (hit?.layer.id === "infra-chokepoints-centre") {
        ui.setInfraOpen(true);
        map.easeTo({
          center: (hit.geometry as GeoJSON.Point).coordinates as [number, number],
          zoom: Math.max(map.getZoom(), 5),
          duration: 700,
        });
        return;
      }
      // Any click on the map dismisses the place-search marker.
      if (ui.searchPin) ui.setSearchPin(null);
      if (hit && EVENT_POINT_LAYERS.includes(hit.layer.id)) {
        ui.selectEvent(String(hit.properties.id));
        return;
      }
      if (hit?.layer.id === "ev-cluster") {
        const src = map.getSource(EVENTS_SOURCE) as GeoJSONSource;
        const center = (hit.geometry as GeoJSON.Point).coordinates as [number, number];
        const zoom = await src.getClusterExpansionZoom(Number(hit.properties.cluster_id));
        if (zoom <= 14 && map.getZoom() < 9) {
          map.easeTo({ center, zoom: Math.min(zoom + 0.3, 14), duration: 700 });
          return;
        }
        // Events that share (nearly) the same point: list them instead of zooming forever.
        const leaves = await src.getClusterLeaves(Number(hit.properties.cluster_id), 25, 0);
        const byId = new Map(useData.getState().visible.map((ev) => [ev.id, ev]));
        const el = document.createElement("div");
        el.style.cssText = "max-height:260px;overflow:auto;min-width:240px";
        const head = document.createElement("div");
        head.className = "meta";
        head.style.cssText = "color:var(--text-faint);margin-bottom:4px";
        head.textContent = `${hit.properties.point_count} events at this location`;
        el.append(head);
        for (const leaf of leaves) {
          const ev = byId.get(String(leaf.properties?.id));
          if (!ev) continue;
          const b = document.createElement("button");
          b.style.cssText = "display:block;width:100%;text-align:left;padding:4px 2px;border-top:1px solid var(--border);font-size:12px;line-height:1.3";
          const cat = document.createElement("span");
          cat.className = "meta";
          cat.style.color = CATEGORIES[ev.type].color;
          cat.textContent = CATEGORIES[ev.type].label + "  ";
          const t = document.createElement("span");
          t.textContent = ev.title;
          b.append(cat, t);
          b.onclick = () => {
            popupRef.current?.remove();
            useUI.getState().selectEvent(ev.id);
          };
          el.append(b);
        }
        listPopupRef.current?.remove();
        listPopupRef.current = new (getMaplibre().Popup)({
          closeButton: true,
          closeOnClick: true,
          offset: 14,
          maxWidth: "320px",
        })
          .setLngLat(center)
          .setDOMContent(el)
          .addTo(map);
        return;
      }
      if (hit?.layer.id === "cam-cluster") {
        const src = map.getSource(CAMERAS_SOURCE) as GeoJSONSource;
        const zoom = await src.getClusterExpansionZoom(Number(hit.properties.cluster_id));
        map.easeTo({
          center: (hit.geometry as GeoJSON.Point).coordinates as [number, number],
          zoom: Math.min(zoom + 0.3, 14),
          duration: 600,
        });
        return;
      }
      if (hit?.layer.id === "cam-point") {
        const data = camerasRef.current;
        const row = data?.rows.find((r) => r[0] === hit.properties.id);
        if (data && row)
          ui.selectCamera({
            row,
            source: data.sources[row[4]],
            health: data.health?.[data.sources[row[4]].id],
          });
        return;
      }
      if (hit?.layer.id === "density-fill") {
        map.easeTo({
          center: e.lngLat,
          zoom: Math.max(map.getZoom() + 1.5, 4),
          duration: 700,
        });
        return;
      }
      const track = hit ? trackRefOf(hit) : null;
      if (track) {
        popupRef.current?.remove();
        ui.selectTrack(track);
        return;
      }
      if (hit) return; // ISS: popup only
      if (map.getZoom() >= REGION_ZOOM && ui.mapMode !== "markets" && map.getLayer("region-fill")) {
        const region = map.queryRenderedFeatures(e.point, {
          layers: ["region-fill"],
        })[0];
        if (region?.id !== undefined) {
          ui.selectRegion(Number(region.id));
          return;
        }
      }
      const country = map.getLayer("country-fill") ? map.queryRenderedFeatures(e.point, { layers: ["country-fill"] })[0] : undefined;
      if (country?.properties?.code) ui.selectCountry(String(country.properties.code));
    });

    const ro = new ResizeObserver(() => map.resize());
    ro.observe(container.current);

    return () => {
      ro.disconnect();
      popupRef.current?.remove();
      map.remove();
      mapRef.current = null;
      loadedMap.current = null;
      setMapObj(null);
      setReady(false);
    };
  }, []);

  // ---- data -------------------------------------------------------------
  useEffect(() => {
    const map = liveMap();
    if (!ready || !map) return;
    const fc = toFeatureCollection(visible, win);
    (map.getSource(EVENTS_SOURCE) as GeoJSONSource | undefined)?.setData(fc);
    (map.getSource(FLAT_SOURCE) as GeoJSONSource | undefined)?.setData(fc);
    (map.getSource(DENSITY_SOURCE) as GeoJSONSource | undefined)?.setData(densityGrid(visible));
    const areas = areaCollection(visible);
    areaIds.current = areas.ids;
    selectedAreaFid.current = null;
    (map.getSource(AREAS_SOURCE) as GeoJSONSource | undefined)?.setData(areas.fc);
  }, [visible, win, ready]);

  // ---- live layers (aircraft / vessels) ------------------------------------
  useEffect(() => {
    const map = liveMap();
    if (!ready || !map) return;
    const aircraft = live?.layerId === "aviation" ? (live.data as AviationData) : null;
    // Vessels come from the Maritime mode, or from the SHIP overlay in any other mode.
    const vessels = live?.layerId === "maritime" ? (live.data as MaritimeData) : showShips ? (shipsVp.data?.data ?? null) : null;
    (map.getSource(AIRCRAFT_SOURCE) as GeoJSONSource | undefined)?.setData(
      aircraft
        ? {
            type: "FeatureCollection",
            features: aircraft.rows.map(([icao24, callsign, country, lon, lat, alt, speed, track, onGround]) => ({
              type: "Feature",
              geometry: { type: "Point", coordinates: [lon, lat] },
              properties: {
                icao24,
                callsign,
                country,
                alt,
                speed,
                track,
                onGround,
              },
            })),
          }
        : EMPTY_FC,
    );
    (map.getSource(VESSELS_SOURCE) as GeoJSONSource | undefined)?.setData(vessels ? vesselFeatures(vessels) : EMPTY_FC);
    // Ship coverage outline: the keyless feeds only see part of the world.
    const feeds = vessels?.source === "keyless" ? (vessels.feeds ?? []).map((f) => f.id) : vessels?.source === "digitraffic" ? ["digitraffic"] : [];
    (map.getSource(SHIP_COVERAGE_SOURCE) as GeoJSONSource | undefined)?.setData(shipCoverageCollection(feeds));
    useTracking.setState({
      ships: vessels,
      aviation: aircraft
        ? {
            fields: [],
            rows: aircraft.rows.map(([icao24, callsign, , lon, lat, altM, speedMs, track, onGround, squawk]): AirRow => [
              icao24,
              callsign,
              "",
              "",
              lon,
              lat,
              altM === null ? null : Math.round(altM / 0.3048),
              onGround,
              speedMs === null ? null : Math.round(speedMs * 1.944),
              track === null ? null : Math.round(track),
              squawk ?? "",
              0,
              false,
            ]),
          }
        : null,
    });
  }, [live, showShips, shipsVp.data, ready]);

  // ---- live aircraft around the view (adsb.lol, AIR overlay) -----------------------
  useEffect(() => {
    const map = liveMap();
    if (!ready || !map) return;
    for (const id of AIR_LAYER_IDS) if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", showAircraft ? "visible" : "none");
  }, [showAircraft, ready]);

  useEffect(() => {
    const map = liveMap();
    if (!ready || !map) return;
    const data = showAircraft ? (air.data?.data ?? null) : null;
    // With MIL on, military-flagged aircraft are drawn (in orange) by that overlay only.
    (map.getSource(AIR_SOURCE) as GeoJSONSource | undefined)?.setData(data ? aircraftFeatures(data, showMilAir) : EMPTY_FC);
    useTracking.setState({ aircraft: data });
  }, [air.data, showAircraft, showMilAir, ready]);

  // ---- military-flagged aircraft (adsb.lol) ------------------------------------
  useEffect(() => {
    const map = liveMap();
    if (!ready || !map) return;
    for (const id of MIL_LAYER_IDS) if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", showMilAir ? "visible" : "none");
    const data = showMilAir ? (mil.data?.data ?? null) : null;
    (map.getSource(MIL_SOURCE) as GeoJSONSource | undefined)?.setData(data ? milFeatures(data) : EMPTY_FC);
    useTracking.setState({ mil: data });
  }, [showMilAir, mil.data, ready]);

  // ---- satellites: SGP4 in the browser, positions every 2 s, track every 30 s ----
  const preparedSats = useMemo(() => (showSatellites && sats.data ? prepareSats(sats.data.data.sats) : []), [showSatellites, sats.data]);
  useEffect(() => useTracking.setState({ sats: preparedSats }), [preparedSats]);
  useEffect(() => {
    const map = liveMap();
    if (!ready || !map) return;
    for (const id of SAT_LAYER_IDS) if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", showSatellites ? "visible" : "none");
    const pts = map.getSource(SAT_SOURCE) as GeoJSONSource | undefined;
    const track = map.getSource(SAT_TRACK_SOURCE) as GeoJSONSource | undefined;
    if (!showSatellites || !preparedSats.length) {
      pts?.setData(EMPTY_FC);
      track?.setData(EMPTY_FC);
      return;
    }
    const sel = preparedSats.find((s) => s.el.id === selectedSat) ?? null;
    map.setFilter("sat-selected", ["==", ["get", "id"], sel ? sel.el.id : -1]);
    let tick = 0;
    const update = () => {
      if (document.hidden) return;
      const now = Date.now();
      pts?.setData(satFeatures(preparedSats, now, selectedSat));
      if (tick++ % 15 === 0) track?.setData(sel ? satTrackFeatures(sel, now, SAT_COLORS[sel.el.group]) : EMPTY_FC);
    };
    update();
    const t = setInterval(update, 2_000);
    return () => clearInterval(t);
  }, [showSatellites, preparedSats, selectedSat, ready]);

  // ---- selected tracked object: highlight ring, trail, follow ---------------------
  const trail = useTracking((s) => s.trail);
  const lastSelected = useRef<TrackRef | null>(null);
  const trackData = useTracking((s) =>
    selectedTrack?.kind === "ship" ? s.ships : selectedTrack?.kind === "aircraft" ? (selectedTrack.mil ? s.mil : (s.aircraft ?? s.aviation)) : s.sats,
  );
  useEffect(() => {
    const map = liveMap();
    if (!ready || !map) return;
    if (!selectedTrack) {
      hl.current.selected = null;
      drawHighlight(map);
      return;
    }
    const update = () => {
      const st = useTracking.getState();
      const pos = trackPosition(selectedTrack, {
        ships: st.ships,
        aircraft: st.aircraft ?? st.aviation,
        mil: st.mil,
        sats: st.sats,
      });
      // Not in the loaded data (e.g. an aircraft opened from the aviation mode): fall back to the trail's end.
      const last = st.trail[st.trail.length - 1];
      hl.current.selected = pos ?? (last ? { lon: last[0], lat: last[1] } : null);
      drawHighlight(map);
      const sel = hl.current.selected;
      if (sel && useUI.getState().followTrack) {
        const panelPad = { top: 60, bottom: 110, left: 40, right: 440 };
        map.easeTo({
          center: [sel.lon, sel.lat],
          zoom: Math.max(map.getZoom(), selectedTrack.kind === "sat" ? 2.5 : 6),
          padding: panelPad,
          duration: 900,
          essential: true,
        });
      }
    };
    update();
    // A newly selected object hidden under the detail panel: pan it into view.
    const sel = hl.current.selected;
    if (sel && selectedTrack !== lastSelected.current) {
      const p = map.project([sel.lon, sel.lat]);
      const w = map.getCanvas().clientWidth;
      if (p.x > w - 440)
        map.easeTo({
          center: [sel.lon, sel.lat],
          padding: { top: 60, bottom: 110, left: 40, right: 440 },
          duration: 700,
        });
    }
    lastSelected.current = selectedTrack;
    // Satellites move continuously; everything else updates with its data.
    if (selectedTrack.kind !== "sat") return;
    const t = setInterval(update, 2_000);
    return () => clearInterval(t);
  }, [selectedTrack, followTrack, trackData, trail, ready]);

  // ---- public cameras ---------------------------------------------------------
  useEffect(() => {
    const map = liveMap();
    if (!ready || !map) return;
    const data = showCameras ? (cameras.data?.data ?? null) : null;
    camerasRef.current = data;
    for (const id of ["cam-cluster", "cam-count", "cam-point"]) if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", showCameras ? "visible" : "none");
    (map.getSource(CAMERAS_SOURCE) as GeoJSONSource | undefined)?.setData(
      data
        ? {
            type: "FeatureCollection",
            features: data.rows
              .filter((r) => !camerasLiveOnly || isLiveRow(r))
              .map((r) => ({
                type: "Feature",
                geometry: { type: "Point", coordinates: [r[2], r[3]] },
                properties: {
                  id: r[0],
                  name: r[1],
                  sourceName: data.sources[r[4]]?.name ?? "",
                  live: isLiveRow(r),
                },
              })),
          }
        : EMPTY_FC,
    );
  }, [showCameras, camerasLiveOnly, cameras.data, ready]);

  // ---- space overlays (ISS, aurora) — independent of map modes ----------------
  useEffect(() => {
    const map = liveMap();
    if (!ready || !map) return;
    for (const id of ISS_LAYER_IDS) if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", showIss ? "visible" : "none");
    const data = showIss ? (iss.data?.data ?? null) : null;
    const fc = data ? issFeatures(data) : null;
    (map.getSource(ISS_SOURCE) as GeoJSONSource | undefined)?.setData(fc?.point ?? EMPTY_FC);
    (map.getSource(ISS_TRACK_SOURCE) as GeoJSONSource | undefined)?.setData(fc?.track ?? EMPTY_FC);
  }, [showIss, iss.data, ready]);

  useEffect(() => {
    const map = liveMap();
    if (!ready || !map) return;
    for (const id of AURORA_LAYER_IDS) if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", showAurora ? "visible" : "none");
    const data = showAurora ? (aurora.data?.data ?? null) : null;
    auroraRef.current = data;
    (map.getSource(AURORA_SOURCE) as GeoJSONSource | undefined)?.setData(data ? auroraFeatures(data) : EMPTY_FC);
  }, [showAurora, aurora.data, ready]);

  // ---- strategic infrastructure — independent of map modes, files load on first toggle ----
  useEffect(() => {
    const map = liveMap();
    if (!ready || !map) return;
    const { setStatus, status } = useInfra.getState();
    for (const id of INFRA_LAYER_IDS) {
      const show = infraOn.includes(id);
      for (const layer of INFRA_MAP_LAYERS[id]) if (map.getLayer(layer)) map.setLayoutProperty(layer, "visibility", show ? "visible" : "none");
      const file = INFRA_LAYER_BY_ID[id].file;
      if (!show || !file || typeof status[id] === "number" || status[id] === "loading") continue;
      setStatus(id, "loading");
      loadInfraFile(file)
        .then((fc) => {
          if (liveMap() !== map) return;
          (map.getSource(infraSource(id)) as GeoJSONSource | undefined)?.setData(fc);
          const count =
            id === "nuclear"
              ? fc.features.filter((f) => f.properties?.f === "Nuclear").length
              : id === "power"
                ? fc.features.filter((f) => f.properties?.f !== "Nuclear").length
                : fc.features.length;
          setStatus(id, count);
        })
        .catch(() => setStatus(id, "error"));
    }
  }, [infraOn, ready]);

  useEffect(() => {
    const map = liveMap();
    if (!ready || !map) return;
    monitorRef.current = new Map((monitor?.chokepoints ?? []).map((c) => [c.id, c]));
    (map.getSource(infraSource("chokepoints")) as GeoJSONSource | undefined)?.setData(chokepointsOn ? chokepointFeatures(monitorRef.current) : EMPTY_FC);
    if (chokepointsOn) useInfra.getState().setStatus("chokepoints", CHOKEPOINTS.length);
  }, [chokepointsOn, monitor, ready]);

  // ---- markets choropleth -----------------------------------------------------
  const marketStateIds = useRef<number[]>([]);
  useEffect(() => {
    const map = liveMap();
    if (!ready || !map) return;
    for (const fid of marketStateIds.current) map.setFeatureState({ source: COUNTRIES_SOURCE, id: fid }, { chg: null });
    marketStateIds.current = [];
    marketByCountry.current.clear();
    if (mapMode !== "markets" || live?.layerId !== "markets") return;
    const data = live.data as {
      countries: Array<{
        country: string;
        name: string;
        changePct: number | null;
      }>;
    };
    for (const c of data.countries) {
      const fid = countryIds.current.get(c.country);
      if (fid === undefined || c.changePct === null) continue;
      marketByCountry.current.set(c.country, {
        name: c.name,
        changePct: c.changePct,
      });
      map.setFeatureState({ source: COUNTRIES_SOURCE, id: fid }, { chg: c.changePct });
      marketStateIds.current.push(fid);
    }
  }, [live, mapMode, ready, countriesLoaded]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- weather radar --------------------------------------------------------
  const radar = live?.layerId === "weather-radar" ? (live.data as RadarData) : null;
  const radarPast = radar ? radar.frames.filter((f) => f.kind === "past") : [];
  const currentFrame = radarPast.length ? radarPast[Math.min(radarFrame ?? radarPast.length - 1, radarPast.length - 1)] : null;

  useEffect(() => {
    const map = liveMap();
    if (!ready || !map) return;
    const wanted = mapMode === "weather" && radar ? (radarPlaying ? radarPast : currentFrame ? [currentFrame] : []) : [];
    const wantedIds = new Set(wanted.map((f) => `radar-${f.time}`));
    // Remove layers no longer needed
    for (const l of map.getStyle().layers ?? []) {
      if (l.id.startsWith("radar-") && !wantedIds.has(l.id)) {
        map.removeLayer(l.id);
        if (map.getSource(l.id)) map.removeSource(l.id);
      }
    }
    for (const f of wanted) {
      const id = `radar-${f.time}`;
      if (!map.getSource(id)) {
        map.addSource(id, {
          type: "raster",
          tiles: [f.tiles],
          tileSize: 256,
          maxzoom: radar!.maxZoom,
          attribution: "Radar © RainViewer",
        });
        map.addLayer(
          {
            id,
            type: "raster",
            source: id,
            paint: { "raster-opacity": 0, "raster-fade-duration": 0 },
          },
          "density-fill",
        );
      }
      map.setPaintProperty(id, "raster-opacity", currentFrame && f.time === currentFrame.time ? 0.72 : 0);
    }
  }, [mapMode, radar, radarPlaying, currentFrame?.time, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!radarPlaying || radarPast.length < 2) return;
    const id = setInterval(() => {
      const ui = useUI.getState();
      const cur = ui.radarFrame ?? radarPast.length - 1;
      ui.setRadarFrame((cur + 1) % radarPast.length);
    }, 700);
    return () => clearInterval(id);
  }, [radarPlaying, radarPast.length]);

  // ---- basemap variant ---------------------------------------------------
  useEffect(() => {
    const map = liveMap();
    if (!ready || !map) return;
    for (const [layer, v] of Object.entries(basemapVisibility(mapStyle, { hires: hiresProvider, hybrid: satLabels }))) {
      if (map.getLayer(layer)) map.setLayoutProperty(layer, "visibility", v);
    }
    map.setMaxZoom(maxZoomFor(mapStyle, hiresProvider));
    map.setPaintProperty(
      "night",
      "fill-opacity",
      mapStyle === "dark"
        ? 0.16
        : mapStyle === "satellite"
          ? // GeoColor / night-band imagery already shows night; street-level imagery should stay readable.
            satSource === "live" || satSource === "night"
            ? 0.06
            : ["interpolate", ["linear"], ["zoom"], 8, 0.24, 12, 0.06]
          : 0.08,
    );
  }, [mapStyle, hiresProvider, satLabels, satSource, ready]);

  // ---- recent satellite imagery (NASA GIBS) ---------------------------------
  // Each new image time gets its own source; the previous one stays underneath
  // until the new tiles have loaded, so the swap never flashes.
  const imageryTimes = imagery.data?.times;
  useEffect(() => {
    const map = liveMap();
    if (!ready || !map) return;
    const want = desiredRasters({ mapStyle, satSource, clouds: showClouds }, imageryTimes ?? {}, new Date());
    const wantIds = new Set(want.map(rasterId));
    const current = (map.getStyle().layers ?? []).map((l) => l.id).filter((id) => id.startsWith("gibs-"));
    const slotOf = rasterSlot;
    const wantSlots = new Set(want.map((w) => slotOf(rasterId(w))));
    const remove = (id: string) => {
      if (map.getLayer(id)) map.removeLayer(id);
      if (map.getSource(id)) map.removeSource(id);
    };
    // Slots no longer wanted go immediately.
    for (const id of current) if (!wantSlots.has(slotOf(id))) remove(id);
    for (const w of want) {
      const id = rasterId(w);
      if (map.getLayer(id)) continue;
      const older = current.find((c) => c !== id && slotOf(c) === slotOf(id) && map.getLayer(c));
      const fadeEnd = Array.isArray(w.opacity) ? Number(w.opacity[w.opacity.length - 2]) : 24;
      map.addSource(id, {
        type: "raster",
        tiles: [gibsTileUrl(w.layer, w.time)],
        tileSize: 256,
        maxzoom: w.layer.maxzoom,
        attribution: `Imagery: ${w.layer.credit} via <a href="https://www.earthdata.nasa.gov/gibs" target="_blank" rel="noopener noreferrer">NASA GIBS</a> — ${w.layer.label}, ${
          w.layer.cadence === "daily" ? w.time : `${w.time.slice(0, 10)} ${w.time.slice(11, 16)} UTC`
        }`,
      });
      map.addLayer(
        {
          id,
          type: "raster",
          source: id,
          maxzoom: fadeEnd,
          paint: { "raster-opacity": w.opacity, "raster-fade-duration": 300 },
        },
        older ?? (w.group === "base" ? IMAGERY_TOP : "boundary-state"),
      );
    }
    // Older frames of a wanted slot are removed once the new tiles have rendered.
    const prune = () => {
      const m = liveMap();
      if (!m) return;
      for (const l of m.getStyle().layers ?? []) if (l.id.startsWith("gibs-") && !wantIdsRef.current.has(l.id)) remove(l.id);
    };
    wantIdsRef.current = wantIds;
    if (current.some((id) => !wantIds.has(id))) map.once("idle", prune);
  }, [mapStyle, satSource, showClouds, imageryTimes, ready]);

  // ---- day / night --------------------------------------------------------
  useEffect(() => {
    const map = liveMap();
    if (!ready || !map) return;
    map.setLayoutProperty("night", "visibility", showDayNight ? "visible" : "none");
    if (!showDayNight) return;
    const update = () => (map.getSource(NIGHT_SOURCE) as GeoJSONSource | undefined)?.setData(nightCollection(new Date()));
    update();
    const id = setInterval(update, 60_000);
    return () => clearInterval(id);
  }, [showDayNight, ready]);

  // ---- labels / modes -----------------------------------------------------
  useEffect(() => {
    const map = liveMap();
    if (!ready || !map) return;
    const visibleLayers = new Set(MODE_LAYERS[mapMode] ?? MODE_LAYERS.events);
    map.setLayoutProperty("ev-label", "visibility", showLabels && visibleLayers.has("ev-point") ? "visible" : "none");
    if (showShips) visibleLayers.add("vessels"); // SHIP overlay works in every mode
    for (const l of ALL_MODE_LAYERS) if (map.getLayer(l)) map.setLayoutProperty(l, "visibility", visibleLayers.has(l) ? "visible" : "none");
  }, [showLabels, mapMode, showShips, ready]);

  // ---- selection highlight ------------------------------------------------
  useEffect(() => {
    const map = liveMap();
    if (!ready || !map) return;
    map.setFilter("ev-selected", ["==", ["get", "id"], selectedEventId ?? "__none__"]);
    if (selectedAreaFid.current !== null) map.setFeatureState({ source: AREAS_SOURCE, id: selectedAreaFid.current }, { selected: false });
    const fid = selectedEventId ? areaIds.current.get(selectedEventId) : undefined;
    if (fid !== undefined) map.setFeatureState({ source: AREAS_SOURCE, id: fid }, { selected: true });
    selectedAreaFid.current = fid ?? null;
  }, [selectedEventId, visible, ready]);

  useEffect(() => {
    const map = liveMap();
    if (!ready || !map) return;
    map.setFilter("ev-hover", ["==", ["get", "id"], hoveredEventId ?? "__none__"]);
  }, [hoveredEventId, ready]);

  useEffect(() => {
    const map = liveMap();
    if (!ready || !map) return;
    if (selectedCountryFid.current !== null) map.setFeatureState({ source: COUNTRIES_SOURCE, id: selectedCountryFid.current }, { selected: false });
    const fid = selectedCountry ? countryIds.current.get(selectedCountry) : undefined;
    if (fid !== undefined) map.setFeatureState({ source: COUNTRIES_SOURCE, id: fid }, { selected: true });
    selectedCountryFid.current = fid ?? null;
  }, [selectedCountry, ready]);

  // ---- selected state/province highlight ---------------------------------------
  useEffect(() => {
    const map = liveMap();
    if (!ready || !map || !map.getSource(REGIONS_SOURCE)) return;
    if (selectedRegionFid.current !== null) map.setFeatureState({ source: REGIONS_SOURCE, id: selectedRegionFid.current }, { selected: false });
    if (selectedRegion !== null) map.setFeatureState({ source: REGIONS_SOURCE, id: selectedRegion }, { selected: true });
    selectedRegionFid.current = selectedRegion;
  }, [selectedRegion, ready]);

  // ---- place-search marker ---------------------------------------------------
  useEffect(() => {
    const map = liveMap();
    if (!ready || !map) return;
    (map.getSource(SEARCH_PIN_SOURCE) as GeoJSONSource | undefined)?.setData(searchPinCollection(searchPin));
  }, [searchPin, ready]);

  // ---- camera -------------------------------------------------------------
  useEffect(() => {
    const map = liveMap();
    if (!ready || !map || !flyTo) return;
    // Keep the target visible beside an open detail panel.
    const ui = useUI.getState();
    const panelOpen = !!(ui.selectedEventId || ui.selectedCountry || ui.selectedRegion !== null || ui.selectedTrack);
    const padding = {
      top: 90,
      bottom: 110,
      left: 40,
      right: panelOpen ? 460 : 40,
    };
    if (flyTo.bbox) {
      const [w, s, e, n] = flyTo.bbox;
      // Very wide boxes (e.g. Russia, antimeridian crossings) → fly to centre instead.
      if (e - w < 160 && e > w) {
        map.fitBounds(
          [
            [w, s],
            [e, n],
          ],
          { padding, duration: 1400, maxZoom: flyTo.zoom ?? 6 },
        );
        return;
      }
    }
    map.flyTo({
      center: [flyTo.lon, flyTo.lat],
      zoom: flyTo.zoom ?? Math.max(map.getZoom(), 4),
      padding,
      duration: 1400,
      essential: true,
    });
  }, [flyTo, ready]);

  return (
    <div className="absolute inset-0">
      <div ref={container} className="h-full w-full" aria-label="Interactive globe of world events" />
      <CameraViewer />
      {mapError && <div className="absolute inset-0 grid place-items-center text-sm text-muted">Map could not be initialised: {mapError}</div>}
      <div
        className={`scroll-thin pointer-events-none absolute right-14 bottom-[118px] flex max-h-[calc(100%-230px)] flex-col items-end gap-2 overflow-y-auto ${sidePanelOpen || layersOpen ? "hidden" : ""}`}
        data-legend-stack
      >
        {(mapStyle === "satellite" || showClouds) && (
          <ImageryPanel
            view={view}
            times={imagery.data?.times ?? null}
            timesError={imagery.error}
            loadingTimes={needsTimes && !imagery.data && !imagery.error}
          />
        )}
        {showCameras && <CameraLegend data={cameras.data?.data ?? null} liveOnly={camerasLiveOnly} />}
        {(showIss || showAurora) && <SpaceLegend iss={showIss ? iss : null} aurora={showAurora ? aurora : null} />}
        {(showShips || showMilAir || showSatellites || showAircraft) && (
          <TrackingLegend
            air={showAircraft ? air : null}
            ships={
              !showShips
                ? null
                : mapMode === "maritime"
                  ? {
                      data: live?.layerId === "maritime" ? (live as LiveLayerResponse<MaritimeData>) : null,
                      error: null,
                      loading: !live,
                    }
                  : ships
            }
            mil={showMilAir ? mil : null}
            sats={showSatellites ? sats : null}
            selectedSat={preparedSats.find((s) => s.el.id === selectedSat)?.el ?? null}
            onClearSat={() => setSelectedSat(null)}
          />
        )}
        {infraOpen && <InfraPanel />}
      </div>
      {layersOpen && (
        <LayersMenu
          onClose={() => setLayersOpen(false)}
          items={[
            {
              id: "ships",
              group: "Live tracking",
              label: "Ships (AIS)",
              hint: "Live vessel positions around the view (Open Waters AIS, Fintraffic, Kystverket; AISStream with a key). Click a ship for details.",
              active: showShips,
              status: layerStatus(
                showShips,
                mapMode === "maritime"
                  ? {
                      data: live?.layerId === "maritime" ? live : null,
                      error: null,
                      loading: !live,
                    }
                  : ships,
              ),
              toggle: () => useUI.getState().updateSettings({ showShips: !showShips }),
            },
            {
              id: "air",
              group: "Live tracking",
              label: "Aircraft",
              hint: "Live aircraft around the map view (adsb.lol). Click a plane for details.",
              active: showAircraft,
              status: showAircraft ? (air.error && !air.data ? "error" : air.data && !(air.loading && !air.data.count) ? fmtCount(air.data.count) : "…") : null,
              toggle: () => useUI.getState().updateSettings({ showAircraft: !showAircraft }),
            },
            {
              id: "mil",
              group: "Live tracking",
              label: "Military aircraft",
              hint: "Worldwide aircraft flagged military in the community database (adsb.lol). Most military flights don't broadcast.",
              active: showMilAir,
              status: layerStatus(showMilAir, mil),
              toggle: () => useUI.getState().updateSettings({ showMilAir: !showMilAir }),
            },
            {
              id: "sats",
              group: "Space",
              label: "Satellites & orbits",
              hint: "Space stations, GPS and the brightest satellites, computed with SGP4 (CelesTrak).",
              active: showSatellites,
              status: layerStatus(showSatellites, sats, sats.data?.data.sats.length),
              toggle: () => {
                if (showSatellites && selectedTrack?.kind === "sat") setSelectedSat(null);
                useUI.getState().updateSettings({ showSatellites: !showSatellites });
              },
            },
            {
              id: "iss",
              group: "Space",
              label: "ISS",
              hint: "International Space Station position and ground track.",
              active: showIss,
              status: layerStatus(showIss, iss, null),
              toggle: () => useUI.getState().updateSettings({ showIss: !showIss }),
            },
            {
              id: "aurora",
              group: "Space",
              label: "Aurora forecast",
              hint: "NOAA OVATION modelled probability of visible aurora.",
              active: showAurora,
              status: layerStatus(showAurora, aurora, null),
              toggle: () => useUI.getState().updateSettings({ showAurora: !showAurora }),
            },
            {
              id: "cams",
              group: "Places",
              label: "Public cameras",
              hint: "Traffic, weather and city webcams. Click one to watch.",
              active: showCameras,
              status: layerStatus(showCameras, cameras),
              toggle: () => useUI.getState().updateSettings({ showCameras: !showCameras }),
            },
            {
              id: "infra",
              group: "Places",
              label: "Infrastructure…",
              hint: "Subsea cables, power plants, pipelines, ports, data centres, bases and chokepoints.",
              active: infraOpen || infraOn.length > 0,
              status: infraOn.length ? `${infraOn.length} on` : null,
              toggle: () => {
                useUI.getState().setInfraOpen(!infraOpen);
                setLayersOpen(false);
              },
            },
            {
              id: "satmap",
              group: "Map",
              label: "Satellite imagery",
              hint: "Satellite basemap (mosaic or recent NASA imagery — choose in the imagery panel).",
              active: mapStyle === "satellite",
              status: null,
              toggle: () =>
                useUI.getState().updateSettings({
                  mapStyle: mapStyle === "satellite" ? "dark" : "satellite",
                }),
            },
            {
              id: "clouds",
              group: "Map",
              label: "Clouds (infrared)",
              hint: "Semi-transparent geostationary infrared clouds over any basemap.",
              active: showClouds,
              status: null,
              toggle: () => useUI.getState().updateSettings({ showClouds: !showClouds }),
            },
            {
              id: "daynight",
              group: "Map",
              label: "Day / night",
              hint: "Shade the part of the world currently in darkness.",
              active: showDayNight,
              status: null,
              toggle: () => useUI.getState().updateSettings({ showDayNight: !showDayNight }),
            },
          ]}
        />
      )}
      <div className="absolute right-3 bottom-[118px] flex flex-col overflow-hidden rounded-md glass">
        <MapButton
          title={
            layersOpen
              ? "Close the layers menu"
              : `Overlays: ships, aircraft, satellites, cameras, infrastructure…${activeOverlays ? ` (${activeOverlays} on)` : ""}`
          }
          onClick={() => setLayersOpen(!layersOpen)}
          active={layersOpen}
          menuToggle
        >
          <span className="relative inline-flex flex-col items-center leading-none">
            <LayersIcon width={15} height={15} />
            {activeOverlays > 0 && (
              <span className="absolute -top-1.5 -right-2.5 min-w-[13px] rounded-full bg-accent px-[3px] text-[8.5px] leading-[13px] font-semibold text-white">
                {activeOverlays}
              </span>
            )}
          </span>
        </MapButton>
        <MapButton
          title={showShips ? "Hide ships (AIS)" : "Show ships (AIS vessel positions) — click one for details"}
          onClick={() => useUI.getState().updateSettings({ showShips: !showShips })}
          active={showShips}
        >
          <span className="text-[9px] font-semibold tracking-wide">{showShips && ships.loading && !ships.data && mapMode !== "maritime" ? "…" : "SHIP"}</span>
        </MapButton>
        <MapButton
          title={showAircraft ? "Hide aircraft" : "Show live aircraft around the view (adsb.lol) — click one for details"}
          onClick={() => useUI.getState().updateSettings({ showAircraft: !showAircraft })}
          active={showAircraft}
        >
          <span className="text-[10px] font-semibold tracking-wide">{showAircraft && air.loading && !air.data ? "…" : "AIR"}</span>
        </MapButton>
        <MapButton
          title={showMilAir ? "Hide military-flagged aircraft" : "Show aircraft broadcasting ADS-B identified as military (adsb.lol)"}
          onClick={() => useUI.getState().updateSettings({ showMilAir: !showMilAir })}
          active={showMilAir}
        >
          <span className="text-[10px] font-semibold tracking-wide">{showMilAir && mil.loading && !mil.data ? "…" : "MIL"}</span>
        </MapButton>
        <MapButton
          title={mapStyle === "satellite" ? "Switch to map view" : "Switch to satellite view (choose mosaic or recent imagery in the panel)"}
          onClick={() =>
            useUI.getState().updateSettings({
              mapStyle: mapStyle === "satellite" ? "dark" : "satellite",
            })
          }
          active={mapStyle === "satellite"}
        >
          <span className="text-[10px] font-semibold tracking-wide">SAT</span>
        </MapButton>
        <MapButton
          title="Zoom in"
          onClick={() =>
            mapRef.current?.easeTo({
              zoom: mapRef.current.getZoom() + 1,
              duration: 300,
            })
          }
        >
          +
        </MapButton>
        <MapButton
          title="Zoom out"
          onClick={() =>
            mapRef.current?.easeTo({
              zoom: mapRef.current.getZoom() - 1,
              duration: 300,
            })
          }
        >
          −
        </MapButton>
        <MapButton
          title="Reset view"
          onClick={() =>
            mapRef.current?.flyTo({
              center: HOME_VIEW.center,
              zoom: HOME_VIEW.zoom,
              pitch: 0,
              bearing: 0,
              duration: 1200,
            })
          }
        >
          ⌂
        </MapButton>
      </div>
    </div>
  );
}

type LayerState<T> = {
  data: LiveLayerResponse<T> | null;
  error: string | null;
  loading: boolean;
};

/** Small key for the space overlays: what is forecast vs computed, with times. */
function SpaceLegend({ iss, aurora }: { iss: LayerState<IssData> | null; aurora: LayerState<AuroraData> | null }) {
  const utc = (t: string | null | undefined) => (t ? `${new Date(t).toISOString().slice(11, 16)} UTC` : "n/a");
  const a = aurora?.data?.data;
  const pos = iss?.data?.data.position;
  return (
    <>
      {iss && (
        <LegendCard id="iss" color={ISS_COLOR} title={`ISS${iss.data?.stale ? " · stale" : ""}`}>
          {pos ? (
            <div className="text-muted">
              {Math.round(pos.altKm)} km · {Math.round(pos.speedKmh).toLocaleString("en-US")} km/h · {utc(pos.time)}
              <div className="text-faint">Computed from orbital elements (wheretheiss.at). Track: past 90 min solid, next 90 min dashed.</div>
            </div>
          ) : (
            <div className="text-faint">{iss.error ?? "Loading…"}</div>
          )}
        </LegendCard>
      )}
      {aurora && (
        <LegendCard id="aurora" color={AURORA_STOPS[0][1]} title={`Aurora forecast${aurora.data?.stale ? " · stale" : ""}`}>
          {a ? (
            <>
              <div className="mt-1 flex h-2 overflow-hidden rounded-full" aria-label="Aurora probability from 10% (green) to 90% (red)">
                {AURORA_STOPS.map(([v, c]) => (
                  <span key={v} className="flex-1" style={{ background: c }} />
                ))}
              </div>
              <div className="meta flex justify-between normal-case tracking-normal text-faint">
                <span>{a.minProbability}%</span>
                <span>90%+</span>
              </div>
              <div className="text-muted">
                Forecast for {utc(a.forecastTime)} (model run {utc(a.observationTime)}) · peak {a.maxProbability}%
              </div>
              <div className="text-faint">NOAA SWPC OVATION — modelled probability of visible aurora, not observed.</div>
            </>
          ) : (
            <div className="text-faint">{aurora.error ?? "Loading…"}</div>
          )}
        </LegendCard>
      )}
    </>
  );
}

/** Camera rows flagged live video (an HLS stream on a source whose sampled streams are healthy). */
const isLiveRow = hasLive;

/** Key for the camera markers, with the "Live video only" filter. */
function CameraLegend({ data, liveOnly }: { data: CamerasData | null; liveOnly: boolean }) {
  const fmt = (n: number) => n.toLocaleString("en-US");
  return (
    <LegendCard id="cameras" color={CAMERA_COLOR} title={`Public cameras${data ? ` · ${fmt(data.rows.length)}` : ""}`}>
      <div className="flex items-center gap-1.5 text-muted">
        <span
          className="inline-block h-2.5 w-2.5 rounded-full"
          style={{
            background: CAMERA_LIVE_COLOR,
            boxShadow: "0 0 0 1.4px #fff",
          }}
        />
        Live video{data ? ` · ${fmt(data.liveCount ?? 0)}` : ""}
      </div>
      {!liveOnly && (
        <div className="flex items-center gap-1.5 text-muted">
          <span className="inline-block h-2 w-2 rounded-full opacity-70" style={{ background: CAMERA_COLOR }} />
          Still image / clip
          {data ? ` · ${fmt(data.rows.length - (data.liveCount ?? 0))}` : ""}
        </div>
      )}
      <label className="mt-1.5 flex cursor-pointer items-center gap-1.5 text-muted hover:text-fg">
        <input type="checkbox" checked={liveOnly} onChange={(e) => useUI.getState().updateSettings({ camerasLiveOnly: e.target.checked })} />
        Live video only
      </label>
      {data && data.hidden?.length > 0 && (
        <div className="mt-1 text-faint" title="Every sampled image and stream from these operators failed in the last liveness check">
          Hidden, not responding: {data.hidden.map((id) => data.sources.find((s) => s.id === id)?.region ?? id).join(", ")}
        </div>
      )}
      <div className="text-faint">Streams and images load from each operator only while a viewer is open.</div>
    </LegendCard>
  );
}

function MapButton({
  title,
  onClick,
  children,
  active,
  menuToggle,
}: {
  title: string;
  onClick: () => void;
  children: React.ReactNode;
  active?: boolean;
  menuToggle?: boolean;
}) {
  return (
    <button
      data-layers-button={menuToggle ? "" : undefined}
      title={title}
      aria-label={title}
      aria-pressed={active}
      onClick={onClick}
      className={`h-8 w-8 border-b border-line text-[15px] last:border-b-0 hover:bg-panel-hover hover:text-fg ${active ? "bg-accent/20 text-fg" : "text-muted"}`}
    >
      {children}
    </button>
  );
}

const fmtCount = (n: number) => n.toLocaleString("en-US");

/** Short status for a layers-menu row: count, "…" while loading, or "error". */
function layerStatus(on: boolean, l: { data: { count: number } | null; error: string | null; loading: boolean }, count?: number | null): string | null {
  if (!on) return null;
  if (l.data) return count === null ? "on" : fmtCount(count ?? l.data.count);
  if (l.error) return "error";
  return "…";
}

interface LayerItem {
  id: string;
  group: string;
  label: string;
  hint: string;
  active: boolean;
  status: string | null;
  toggle: () => void;
}

/** Compact overlay menu beside the map buttons (fits short screens; closes on Esc / outside click). */
function LayersMenu({ items, onClose }: { items: LayerItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      if (ref.current && !ref.current.contains(t) && !t.closest("[data-layers-button]")) onClose();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown);
    };
  }, [onClose]);
  return (
    <div
      ref={ref}
      role="menu"
      aria-label="Map overlays"
      className="glass panel-in scroll-thin absolute right-14 bottom-[118px] z-10 max-h-[calc(100%-200px)] w-[240px] overflow-y-auto rounded-md py-1.5 shadow-2xl shadow-black/50"
    >
      <div className="flex items-baseline justify-between px-3 pt-1 pb-1.5">
        <span className="text-[12.5px] font-semibold text-fg">Layers</span>
        <span className="meta normal-case tracking-normal text-faint">click map objects for details</span>
      </div>
      {items.map((it, i) => (
        <div key={it.id}>
          {(i === 0 || items[i - 1].group !== it.group) && (
            <div className={`meta px-3 pb-0.5 text-faint ${i ? "mt-1 border-t border-line pt-2" : ""}`}>{it.group}</div>
          )}
          <button
            role="menuitemcheckbox"
            aria-checked={it.active}
            data-layer={it.id}
            title={it.hint}
            onClick={it.toggle}
            className="flex w-full items-start gap-2.5 px-3 py-1 text-left hover:bg-panel-hover"
          >
            <span
              className={`mt-[3px] grid h-3.5 w-3.5 shrink-0 place-items-center rounded-[3px] border ${it.active ? "border-accent bg-accent text-white" : "border-line"}`}
            >
              {it.active && <span className="text-[9px] leading-none">✓</span>}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline justify-between gap-2 text-[12.5px] text-fg">
                {it.label}
                {it.status && <span className={`meta normal-case tracking-normal ${it.status === "error" ? "text-danger" : "text-faint"}`}>{it.status}</span>}
              </span>
            </span>
          </button>
        </div>
      ))}
    </div>
  );
}
