"use client";
/**
 * Interactive 3D globe (MapLibre GL globe projection).
 * Rendering is fully WebGL: clustering, points, heatmap and country hit-testing
 * happen in map layers — never as DOM markers.
 */
import { useEffect, useRef, useState } from "react";
import type { GeoJSONSource, Map as MlMap, MapGeoJSONFeature, PointLike, Popup } from "maplibre-gl";
import { getMaplibre } from "./maplibre";
import { buildStyle, labelLayers, variantVisibility } from "./style";
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
  toFeatureCollection, CAMERAS_SOURCE, CAMERA_COLOR, CAMERA_LIVE_COLOR, cameraLayers, REGIONS_SOURCE, regionLayers,
  AURORA_LAYER_IDS,
  AURORA_SOURCE,
  AURORA_STOPS,
  ISS_COLOR,
  ISS_LAYER_IDS,
  ISS_SOURCE,
  ISS_TRACK_SOURCE,
  auroraLayers,
  issLayers,
} from "./layers";
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
import { CameraViewer } from "@/components/cameras/CameraViewer";
import { loadRegions, REGION_ZOOM } from "@/lib/client/regions";
import { useData } from "@/lib/client/data-store";
import { CATEGORIES } from "@/lib/categories";
import { relativeTime } from "@/lib/time";
import type { EventCategory } from "@/types/events";

export const HOME_VIEW = { center: [-30, 26] as [number, number], zoom: 2.05 };

const EMPTY_FC: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

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
  const radarFrame = useUI((s) => s.radarFrame);
  const radarPlaying = useUI((s) => s.radarPlaying);
  const showCameras = useUI((s) => s.settings.showCameras);
  const cameras = useLiveLayer<CamerasData>(showCameras ? "cameras" : null, 30 * 60_000);
  const camerasLiveOnly = useUI((s) => s.settings.camerasLiveOnly);
  const showIss = useUI((s) => s.settings.showIss);
  const showAurora = useUI((s) => s.settings.showAurora);
  const iss = useLiveLayer<IssData>(showIss ? "iss" : null, 5_000, { pauseWhenHidden: true });
  const aurora = useLiveLayer<AuroraData>(showAurora ? "aurora" : null, 10 * 60_000, { pauseWhenHidden: true });
  const auroraRef = useRef<AuroraData | null>(null);

  // ---- init -------------------------------------------------------------
  useEffect(() => {
    if (!container.current) return;
    const maplibregl = getMaplibre();
    let map: MlMap;
    try {
      map = new maplibregl.Map({
        container: container.current,
        style: buildStyle(useUI.getState().settings.mapStyle),
        center: HOME_VIEW.center,
        zoom: HOME_VIEW.zoom,
        minZoom: 0.6,
        maxZoom: 14,
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
    popupRef.current = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 12, maxWidth: "280px" });

    map.on("error", (e) => {
      // Tile/network errors are non-fatal; log once for developers.
      if (e?.error?.message) console.debug("[globe]", e.error.message);
    });

    map.on("load", () => {
      map.addSource(NIGHT_SOURCE, { type: "geojson", data: nightCollection(new Date()) });
      map.addLayer(nightLayer());

      map.addSource(COUNTRIES_SOURCE, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
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
      map.addSource(CAMERAS_SOURCE, { type: "geojson", data: EMPTY_FC, cluster: true, clusterRadius: 38, clusterMaxZoom: 11 });
      for (const l of cameraLayers()) map.addLayer(l);
      map.addSource(ISS_TRACK_SOURCE, { type: "geojson", data: EMPTY_FC });
      map.addSource(ISS_SOURCE, { type: "geojson", data: EMPTY_FC });
      for (const l of issLayers()) map.addLayer(l);
      for (const l of labelLayers()) map.addLayer(l);

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
        return popupLines(coords, { text: "Aircraft", color: "#4dabf7" }, String(p.callsign || p.icao24), [p.country, p.onGround ? "on ground" : alt, spd].filter(Boolean).join(" · "));
      }
      if (f.layer.id === "vessels") {
        const sog = typeof p.sog === "number" ? `${p.sog} kn` : "speed n/a";
        return popupLines(coords, { text: "Vessel", color: "#4dd4ff" }, String(p.name || `MMSI ${p.mmsi}`), [`MMSI ${p.mmsi}`, sog].join(" · "));
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
      if (f.layer.id === "density-fill") {
        // Polygon cell: caller re-anchors the popup at the cursor.
        return popupLines(coords, { text: "Density", color: "#2f9bbf" }, `${p.count} event${p.count === 1 ? "" : "s"} in this cell`, `Highest importance ${p.maxImp}`);
      }
      const ev = useData.getState().visible.find((e) => e.id === p.id);
      const cat = CATEGORIES[p.type as EventCategory];
      popupLines(
        coords,
        { text: cat?.label ?? String(p.type), color: cat?.color ?? "#aaa" },
        ev?.title ?? String(p.title),
        ev
          ? [ev.countryName ?? ev.locationName, relativeTime(ev.timestamp), `${ev.sourceCount} source${ev.sourceCount === 1 ? "" : "s"}`].filter(Boolean).join(" · ")
          : undefined,
      );
    };

    const INTERACTIVE = [...EVENT_POINT_LAYERS, "ev-cluster", "cam-point", "cam-cluster", "aircraft", "vessels", "iss-point", "density-fill", "aurora"];
    const hitAt = (pt: PointLike) =>
      map.queryRenderedFeatures(pt, { layers: INTERACTIVE.filter((l) => map.getLayer(l)) })[0];

    map.on("mousemove", (e) => {
      const top = hitAt(e.point);
      map.getCanvas().style.cursor = top ? "pointer" : "";
      if (top && top.layer.id !== "ev-cluster") {
        showPopup(top);
        if (top.layer.id === "density-fill" || top.layer.id === "aurora") popupRef.current?.setLngLat(e.lngLat);
      } else {
        popupRef.current?.remove();
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
        const rp = region.properties as { name?: string; type?: string; countryName?: string };
        map.getCanvas().style.cursor = "pointer";
        popupLines([e.lngLat.lng, e.lngLat.lat], { text: rp.type ?? "Region", color: "#9cc9ff" }, String(rp.name ?? ""), String(rp.countryName ?? ""));
      }
      // Country hover
      const country = top || regionMode ? undefined : map.queryRenderedFeatures(e.point, { layers: map.getLayer("country-fill") ? ["country-fill"] : [] })[0];
      const idx = country && useUI.getState().mapMode === "markets" ? marketByCountry.current.get(String(country.properties?.code)) : undefined;
      if (idx) {
        const up = idx.changePct >= 0;
        popupLines(
          [e.lngLat.lng, e.lngLat.lat],
          { text: String(country!.properties?.name ?? ""), color: up ? "#3f8de8" : "#e5534b" },
          `${idx.name} ${up ? "▲" : "▼"} ${up ? "+" : ""}${idx.changePct.toFixed(2)}%`,
          "Daily change vs previous close (delayed)",
        );
      }
      const fid = country?.id !== undefined ? Number(country.id) : null;
      if (fid !== hoveredCountry.current) {
        if (hoveredCountry.current !== null) map.setFeatureState({ source: COUNTRIES_SOURCE, id: hoveredCountry.current }, { hover: false });
        if (fid !== null) map.setFeatureState({ source: COUNTRIES_SOURCE, id: fid }, { hover: true });
        hoveredCountry.current = fid;
      }
    });
    map.on("mouseout", () => {
      popupRef.current?.remove();
      if (hoveredCountry.current !== null) map.setFeatureState({ source: COUNTRIES_SOURCE, id: hoveredCountry.current }, { hover: false });
      hoveredCountry.current = null;
      if (hoveredRegion.current !== null) map.setFeatureState({ source: REGIONS_SOURCE, id: hoveredRegion.current }, { hover: false });
      hoveredRegion.current = null;
    });

    map.on("click", async (e) => {
      const top = hitAt(e.point);
      // The aurora overlay is hover-only; clicks pass through to countries/regions.
      const hit = top?.layer.id === "aurora" ? undefined : top;
      const ui = useUI.getState();
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
        listPopupRef.current = new (getMaplibre().Popup)({ closeButton: true, closeOnClick: true, offset: 14, maxWidth: "320px" })
          .setLngLat(center)
          .setDOMContent(el)
          .addTo(map);
        return;
      }
      if (hit?.layer.id === "cam-cluster") {
        const src = map.getSource(CAMERAS_SOURCE) as GeoJSONSource;
        const zoom = await src.getClusterExpansionZoom(Number(hit.properties.cluster_id));
        map.easeTo({ center: (hit.geometry as GeoJSON.Point).coordinates as [number, number], zoom: Math.min(zoom + 0.3, 14), duration: 600 });
        return;
      }
      if (hit?.layer.id === "cam-point") {
        const data = camerasRef.current;
        const row = data?.rows.find((r) => r[0] === hit.properties.id);
        if (data && row) ui.selectCamera({ row, source: data.sources[row[4]] });
        return;
      }
      if (hit?.layer.id === "density-fill") {
        map.easeTo({ center: e.lngLat, zoom: Math.max(map.getZoom() + 1.5, 4), duration: 700 });
        return;
      }
      if (hit) return; // aircraft / vessels / ISS: popup only
      if (map.getZoom() >= REGION_ZOOM && ui.mapMode !== "markets" && map.getLayer("region-fill")) {
        const region = map.queryRenderedFeatures(e.point, { layers: ["region-fill"] })[0];
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
    const vessels = live?.layerId === "maritime" ? (live.data as MaritimeData) : null;
    (map.getSource(AIRCRAFT_SOURCE) as GeoJSONSource | undefined)?.setData(
      aircraft
        ? {
            type: "FeatureCollection",
            features: aircraft.rows.map(([icao24, callsign, country, lon, lat, alt, speed, track, onGround]) => ({
              type: "Feature",
              geometry: { type: "Point", coordinates: [lon, lat] },
              properties: { icao24, callsign, country, alt, speed, track, onGround },
            })),
          }
        : EMPTY_FC,
    );
    (map.getSource(VESSELS_SOURCE) as GeoJSONSource | undefined)?.setData(
      vessels
        ? {
            type: "FeatureCollection",
            features: vessels.rows.map(([mmsi, name, lon, lat, sog, cog, heading]) => ({
              type: "Feature",
              geometry: { type: "Point", coordinates: [lon, lat] },
              properties: { mmsi, name, sog, heading: heading ?? cog },
            })),
          }
        : EMPTY_FC,
    );
  }, [live, ready]);

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
                properties: { id: r[0], name: r[1], sourceName: data.sources[r[4]]?.name ?? "", live: isLiveRow(r) },
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

  // ---- markets choropleth -----------------------------------------------------
  const marketStateIds = useRef<number[]>([]);
  useEffect(() => {
    const map = liveMap();
    if (!ready || !map) return;
    for (const fid of marketStateIds.current) map.setFeatureState({ source: COUNTRIES_SOURCE, id: fid }, { chg: null });
    marketStateIds.current = [];
    marketByCountry.current.clear();
    if (mapMode !== "markets" || live?.layerId !== "markets") return;
    const data = live.data as { countries: Array<{ country: string; name: string; changePct: number | null }> };
    for (const c of data.countries) {
      const fid = countryIds.current.get(c.country);
      if (fid === undefined || c.changePct === null) continue;
      marketByCountry.current.set(c.country, { name: c.name, changePct: c.changePct });
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
        map.addSource(id, { type: "raster", tiles: [f.tiles], tileSize: 256, maxzoom: radar!.maxZoom, attribution: "Radar © RainViewer" });
        map.addLayer({ id, type: "raster", source: id, paint: { "raster-opacity": 0, "raster-fade-duration": 0 } }, "density-fill");
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
    for (const [layer, v] of Object.entries(variantVisibility(mapStyle))) {
      if (map.getLayer(layer)) map.setLayoutProperty(layer, "visibility", v);
    }
    map.setPaintProperty("night", "fill-opacity", mapStyle === "dark" ? 0.16 : mapStyle === "satellite" ? 0.24 : 0.08);
  }, [mapStyle, ready]);

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
    for (const l of ALL_MODE_LAYERS) if (map.getLayer(l)) map.setLayoutProperty(l, "visibility", visibleLayers.has(l) ? "visible" : "none");
  }, [showLabels, mapMode, ready]);

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

  // ---- camera -------------------------------------------------------------
  useEffect(() => {
    const map = liveMap();
    if (!ready || !map || !flyTo) return;
    // Keep the target visible beside an open detail panel.
    const ui = useUI.getState();
    const panelOpen = !!(ui.selectedEventId || ui.selectedCountry || ui.selectedRegion !== null);
    const padding = { top: 90, bottom: 110, left: 40, right: panelOpen ? 460 : 40 };
    if (flyTo.bbox) {
      const [w, s, e, n] = flyTo.bbox;
      // Very wide boxes (e.g. Russia, antimeridian crossings) → fly to centre instead.
      if (e - w < 160 && e > w) {
        map.fitBounds([[w, s], [e, n]], { padding, duration: 1400, maxZoom: flyTo.zoom ?? 6 });
        return;
      }
    }
    map.flyTo({ center: [flyTo.lon, flyTo.lat], zoom: flyTo.zoom ?? Math.max(map.getZoom(), 4), padding, duration: 1400, essential: true });
  }, [flyTo, ready]);

  return (
    <div className="absolute inset-0">
      <div ref={container} className="h-full w-full" aria-label="Interactive globe of world events" />
      <CameraViewer />
      {mapError && (
        <div className="absolute inset-0 grid place-items-center text-sm text-muted">
          Map could not be initialised: {mapError}
        </div>
      )}
      {(showIss || showAurora || showCameras) && (
        <div className="pointer-events-none absolute right-14 bottom-[118px] flex w-[230px] flex-col gap-2">
          {showCameras && <CameraLegend data={cameras.data?.data ?? null} liveOnly={camerasLiveOnly} />}
          {(showIss || showAurora) && <SpaceLegend iss={showIss ? iss : null} aurora={showAurora ? aurora : null} />}
        </div>
      )}
      <div className="absolute right-3 bottom-[118px] flex flex-col overflow-hidden rounded-md glass">
        <MapButton
          title={showIss ? "Hide International Space Station" : "Show International Space Station position and ground track"}
          onClick={() => useUI.getState().updateSettings({ showIss: !showIss })}
          active={showIss}
        >
          <span className="text-[10px] font-semibold tracking-wide">{showIss && iss.loading && !iss.data ? "…" : "ISS"}</span>
        </MapButton>
        <MapButton
          title={showAurora ? "Hide aurora forecast" : "Show aurora forecast (NOAA OVATION)"}
          onClick={() => useUI.getState().updateSettings({ showAurora: !showAurora })}
          active={showAurora}
        >
          <span className="text-[10px] font-semibold tracking-wide">{showAurora && aurora.loading && !aurora.data ? "…" : "AUR"}</span>
        </MapButton>
        <MapButton
          title={showCameras ? `Hide public cameras${cameras.data ? ` (${cameras.data.count.toLocaleString("en-US")})` : ""}` : "Show public cameras"}
          onClick={() => useUI.getState().updateSettings({ showCameras: !showCameras })}
          active={showCameras}
        >
          <span className="text-[10px] font-semibold tracking-wide">{showCameras && cameras.loading && !cameras.data ? "…" : "CAM"}</span>
        </MapButton>
        <MapButton
          title={mapStyle === "satellite" ? "Switch to map view" : "Switch to satellite view"}
          onClick={() => useUI.getState().updateSettings({ mapStyle: mapStyle === "satellite" ? "dark" : "satellite" })}
          active={mapStyle === "satellite"}
        >
          <span className="text-[10px] font-semibold tracking-wide">SAT</span>
        </MapButton>
        <MapButton title="Zoom in" onClick={() => mapRef.current?.easeTo({ zoom: mapRef.current.getZoom() + 1, duration: 300 })}>+</MapButton>
        <MapButton title="Zoom out" onClick={() => mapRef.current?.easeTo({ zoom: mapRef.current.getZoom() - 1, duration: 300 })}>−</MapButton>
        <MapButton
          title="Reset view"
          onClick={() => mapRef.current?.flyTo({ center: HOME_VIEW.center, zoom: HOME_VIEW.zoom, pitch: 0, bearing: 0, duration: 1200 })}
        >
          ⌂
        </MapButton>
      </div>
    </div>
  );
}

type LayerState<T> = { data: LiveLayerResponse<T> | null; error: string | null; loading: boolean };

/** Small key for the space overlays: what is forecast vs computed, with times. */
function SpaceLegend({ iss, aurora }: { iss: LayerState<IssData> | null; aurora: LayerState<AuroraData> | null }) {
  const utc = (t: string | null | undefined) => (t ? `${new Date(t).toISOString().slice(11, 16)} UTC` : "n/a");
  const a = aurora?.data?.data;
  const pos = iss?.data?.data.position;
  return (
    <div className="glass pointer-events-auto space-y-2 rounded-md px-3 py-2 text-[11px] leading-snug">
      {iss && (
        <div>
          <div className="meta" style={{ color: ISS_COLOR }}>
            ISS {iss.data?.stale ? "· stale" : ""}
          </div>
          {pos ? (
            <div className="text-muted">
              {Math.round(pos.altKm)} km · {Math.round(pos.speedKmh).toLocaleString("en-US")} km/h · {utc(pos.time)}
              <div className="text-faint">Computed from orbital elements (wheretheiss.at). Track: past 90 min solid, next 90 min dashed.</div>
            </div>
          ) : (
            <div className="text-faint">{iss.error ?? "Loading…"}</div>
          )}
        </div>
      )}
      {aurora && (
        <div>
          <div className="meta" style={{ color: AURORA_STOPS[0][1] }}>
            Aurora forecast {aurora.data?.stale ? "· stale" : ""}
          </div>
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
        </div>
      )}
    </div>
  );
}

/** Camera rows with a live (HLS) stream; matches isLiveVideo in the cameras layer. */
const isLiveRow = (r: CamerasData["rows"][number]) => r[7] === "hls" && !!r[6];

/** Key for the camera markers, with the "Live video only" filter. */
function CameraLegend({ data, liveOnly }: { data: CamerasData | null; liveOnly: boolean }) {
  const fmt = (n: number) => n.toLocaleString("en-US");
  return (
    <div className="glass pointer-events-auto rounded-md px-3 py-2 text-[11px] leading-snug">
      <div className="meta" style={{ color: CAMERA_COLOR }}>
        Public cameras
      </div>
      <div className="mt-1 flex items-center gap-1.5 text-muted">
        <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: CAMERA_LIVE_COLOR, boxShadow: "0 0 0 1.4px #fff" }} />
        Live video{data ? ` · ${fmt(data.liveCount ?? 0)}` : ""}
      </div>
      {!liveOnly && (
        <div className="flex items-center gap-1.5 text-muted">
          <span className="inline-block h-2 w-2 rounded-full opacity-70" style={{ background: CAMERA_COLOR }} />
          Still image / clip{data ? ` · ${fmt(data.rows.length - (data.liveCount ?? 0))}` : ""}
        </div>
      )}
      <label className="mt-1.5 flex cursor-pointer items-center gap-1.5 text-muted hover:text-fg">
        <input type="checkbox" checked={liveOnly} onChange={(e) => useUI.getState().updateSettings({ camerasLiveOnly: e.target.checked })} />
        Live video only
      </label>
      <div className="mt-1 text-faint">Streams and images load from each operator only while a viewer is open.</div>
    </div>
  );
}

function MapButton({ title, onClick, children, active }: { title: string; onClick: () => void; children: React.ReactNode; active?: boolean }) {
  return (
    <button
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
