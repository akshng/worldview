"use client";
/**
 * USGS ShakeMap intensity contours on the globe, toggled from an earthquake's
 * event panel ("Show shaking on map"). The source/layers exist only while the
 * overlay is on, and it's cleared as soon as that event is deselected.
 */
import { useEffect } from "react";
import type { GeoJSONSource, Map as MlMap } from "maplibre-gl";
import { useUI } from "@/lib/store/ui";
import { useShakeOverlay } from "@/lib/enrich/client";
import { FONT_BOLD } from "./style";

export const SHAKE_SOURCE = "shakemap-mmi";
const LAYERS = ["shakemap-mmi-casing", "shakemap-mmi-line", "shakemap-mmi-label"] as const;

export function ShakeMapOverlay({ map }: { map: MlMap }) {
  const selectedEventId = useUI((s) => s.selectedEventId);
  const eventId = useShakeOverlay((s) => s.eventId);
  const data = useShakeOverlay((s) => s.data);

  // Deselecting (or selecting another event) removes the overlay.
  useEffect(() => {
    if (eventId && selectedEventId !== eventId) useShakeOverlay.getState().clear();
  }, [selectedEventId, eventId]);

  useEffect(() => {
    const remove = () => {
      if (!map.getStyle()) return;
      for (const l of LAYERS) if (map.getLayer(l)) map.removeLayer(l);
      if (map.getSource(SHAKE_SOURCE)) map.removeSource(SHAKE_SOURCE);
    };
    if (!data || !data.features.length) {
      remove();
      return;
    }
    const src = map.getSource(SHAKE_SOURCE) as GeoJSONSource | undefined;
    if (src) src.setData(data);
    else {
      map.addSource(SHAKE_SOURCE, { type: "geojson", data, attribution: "Shaking: USGS ShakeMap" });
      // Under the event markers so they stay clickable and visible.
      const before = map.getLayer("ev-heat") ? "ev-heat" : undefined;
      map.addLayer(
        {
          id: "shakemap-mmi-casing",
          type: "line",
          source: SHAKE_SOURCE,
          layout: { "line-join": "round", "line-cap": "round" },
          paint: { "line-color": "rgba(0,0,0,0.55)", "line-width": ["interpolate", ["linear"], ["zoom"], 2, 2.5, 8, 4.5] },
        },
        before,
      );
      map.addLayer(
        {
          id: "shakemap-mmi-line",
          type: "line",
          source: SHAKE_SOURCE,
          layout: { "line-join": "round", "line-cap": "round" },
          paint: {
            "line-color": ["get", "color"],
            "line-width": ["interpolate", ["linear"], ["zoom"], 2, ["case", ["==", ["get", "label"], ""], 0.8, 1.6], 8, ["case", ["==", ["get", "label"], ""], 1.4, 2.8]],
            "line-opacity": ["case", ["==", ["get", "label"], ""], 0.6, 0.95],
          },
        },
        before,
      );
      map.addLayer(
        {
          id: "shakemap-mmi-label",
          type: "symbol",
          source: SHAKE_SOURCE,
          filter: ["!=", ["get", "label"], ""],
          layout: {
            "symbol-placement": "line",
            "symbol-spacing": 260,
            "text-field": ["get", "label"],
            "text-font": FONT_BOLD,
            "text-size": 11,
            "text-keep-upright": true,
          },
          paint: { "text-color": ["get", "color"], "text-halo-color": "rgba(0,0,0,0.85)", "text-halo-width": 1.4 },
        },
        before,
      );
    }
    return undefined;
  }, [map, data]);

  // Unmounting the globe (leaving World) drops the overlay too.
  useEffect(
    () => () => {
      useShakeOverlay.getState().clear();
    },
    [],
  );

  return null;
}
