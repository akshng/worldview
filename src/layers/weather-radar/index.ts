import { httpGet } from "@/data-sources/types";
import type { LiveLayerProvider } from "../types";

interface RainViewerMaps {
  host: string;
  generated: number;
  radar: { past: Array<{ time: number; path: string }>; nowcast: Array<{ time: number; path: string }> };
}

export interface RadarData {
  frames: Array<{ time: string; tiles: string; kind: "past" | "nowcast" }>;
  maxZoom: number;
}

/** Composite precipitation radar from RainViewer (keyless, attribution required). */
export const weatherRadarLayer: LiveLayerProvider<RadarData> = {
  id: "weather-radar",
  name: "Precipitation radar (RainViewer)",
  description: "Composite weather-radar mosaic, past 2 hours in 10-minute frames. Coverage follows national radar networks (not open oceans).",
  homepage: "https://www.rainviewer.com/api.html",
  attribution: "Radar © RainViewer",
  ttlMs: 5 * 60_000,
  async load(ctx) {
    const maps = (await (await httpGet("https://api.rainviewer.com/public/weather-maps.json", ctx)).json()) as RainViewerMaps;
    const tile = (path: string) => `${maps.host}${path}/256/{z}/{x}/{y}/2/1_1.png`;
    const frames = [
      ...maps.radar.past.map((f) => ({ time: new Date(f.time * 1000).toISOString(), tiles: tile(f.path), kind: "past" as const })),
      ...(maps.radar.nowcast ?? []).map((f) => ({ time: new Date(f.time * 1000).toISOString(), tiles: tile(f.path), kind: "nowcast" as const })),
    ];
    const latestPast = maps.radar.past[maps.radar.past.length - 1];
    return {
      layerId: "weather-radar",
      observedAt: new Date((latestPast?.time ?? maps.generated) * 1000).toISOString(),
      retrievedAt: new Date(ctx.now).toISOString(),
      count: frames.length,
      data: { frames, maxZoom: 7 },
      attribution: this.attribution,
      notes: ["Radar coverage exists only where national radar networks share data."],
    };
  },
};
