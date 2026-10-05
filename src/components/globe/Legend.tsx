"use client";
/** Per-mode legend + live-layer status, shown bottom-left over the globe. */
import clsx from "clsx";
import { useUI } from "@/lib/store/ui";
import { modeMeta } from "@/lib/map-modes";
import { formatClock, relativeTime } from "@/lib/time";
import type { LiveLayerResponse } from "@/lib/client/use-live-layer";
import type { RadarData } from "@/layers/weather-radar";
import { ALTITUDE_STOPS, DENSITY_STOPS, DEPTH_STOPS } from "./layers";

function Swatches({ stops, unit, format = (v: number) => v.toLocaleString("en-US") }: { stops: Array<[number, string]>; unit: string; format?: (v: number) => string }) {
  return (
    <div className="flex items-center gap-2">
      {stops.map(([v, c]) => (
        <span key={v} className="flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: c }} />
          <span className="meta tabular normal-case tracking-normal text-muted">{format(v)}</span>
        </span>
      ))}
      <span className="meta normal-case tracking-normal text-faint">{unit}</span>
    </div>
  );
}

export function Legend({ live }: { live: { data: LiveLayerResponse<unknown> | null; error: string | null; loading: boolean } }) {
  const mode = useUI((s) => s.mapMode);
  const radarFrame = useUI((s) => s.radarFrame);
  const radarPlaying = useUI((s) => s.radarPlaying);
  const setRadarFrame = useUI((s) => s.setRadarFrame);
  const setRadarPlaying = useUI((s) => s.setRadarPlaying);
  const meta = modeMeta(mode);
  if (mode === "events") return null;

  const radar = live.data?.layerId === "weather-radar" ? (live.data.data as RadarData) : null;
  const past = radar?.frames.filter((f) => f.kind === "past") ?? [];
  const idx = Math.min(radarFrame ?? past.length - 1, past.length - 1);

  return (
    <div className="glass pointer-events-auto w-[300px] rounded-md px-3 py-2.5">
      <div className="flex items-center justify-between">
        <span className="meta text-fg">{meta.label} mode</span>
        {meta.categories && <span className="meta text-faint">Layers focused</span>}
      </div>
      <p className="mt-1 text-[11.5px] leading-snug text-muted">{meta.description}</p>

      <div className="mt-2 space-y-1.5">
        {mode === "earthquakes" && (
          <>
            <Swatches stops={DEPTH_STOPS} unit="km depth" />
            <div className="meta normal-case tracking-normal text-faint">Circle size grows with magnitude (USGS / GDACS)</div>
          </>
        )}
        {mode === "fires" && <Swatches stops={[[50, "#ffd43b"], [500, "#ff922b"], [3000, "#ff4d1a"], [15000, "#d6001c"]]} unit="MW radiative power" />}
        {mode === "density" && <Swatches stops={DENSITY_STOPS} unit="events / 2° cell" />}
        {mode === "heatmap" && <div className="meta normal-case tracking-normal text-faint">Weighted by importance score</div>}
        {mode === "aviation" && <Swatches stops={ALTITUDE_STOPS} unit="m altitude" format={(v) => (v >= 1000 ? `${v / 1000}k` : String(v))} />}
        {mode === "weather" && past.length > 0 && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setRadarPlaying(!radarPlaying)}
              className="rounded border border-line px-2 py-0.5 text-[11px] text-muted hover:text-fg"
              aria-label={radarPlaying ? "Pause radar loop" : "Play radar loop"}
            >
              {radarPlaying ? "❚❚ Pause" : "▶ Loop 2 h"}
            </button>
            <input
              type="range"
              min={0}
              max={past.length - 1}
              value={idx}
              onChange={(e) => {
                setRadarPlaying(false);
                const v = Number(e.target.value);
                setRadarFrame(v === past.length - 1 ? null : v);
              }}
              className="flex-1 accent-[var(--accent)]"
              aria-label="Radar frame"
            />
            <span className="meta tabular w-12 text-right normal-case tracking-normal text-muted">{formatClock(Date.parse(past[idx].time))}</span>
          </div>
        )}
        {mode === "weather" && (
          <div className="flex h-1.5 overflow-hidden rounded-full" title="Radar reflectivity: light → heavy precipitation">
            {["#88ddee", "#0099cc", "#0077aa", "#ffee00", "#ffaa00", "#ff4400", "#c10000", "#ffaaff"].map((c) => (
              <span key={c} className="flex-1" style={{ background: c }} />
            ))}
          </div>
        )}
      </div>

      {meta.liveLayer && (
        <div className="mt-2 border-t border-line pt-2">
          {live.error ? (
            <p className="text-[11.5px] leading-snug text-warn">{live.error}</p>
          ) : !live.data ? (
            <p className="meta normal-case tracking-normal text-faint">{live.loading ? "Loading live layer…" : "No data"}</p>
          ) : (
            <>
              <div className={clsx("meta normal-case tracking-normal", live.data.stale ? "text-warn" : "text-muted")}>
                {live.data.layerId === "weather-radar" ? `${past.length} frames` : `${live.data.count.toLocaleString("en-US")} ${live.data.layerId === "aviation" ? "aircraft" : "vessels"}`} · observed{" "}
                {relativeTime(live.data.observedAt)}
                {live.data.stale && " (stale — upstream unavailable)"}
              </div>
              {live.data.notes?.map((n) => (
                <p key={n} className="mt-0.5 text-[10.5px] leading-snug text-faint">{n}</p>
              ))}
              <p className="mt-0.5 text-[10.5px] text-faint">{live.data.attribution}</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
