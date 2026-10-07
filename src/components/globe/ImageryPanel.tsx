"use client";
/**
 * Satellite source picker + honest "what am I looking at" label.
 * Mosaics are always labelled as past captures; only geostationary frames are
 * called near-real-time, with their image time and age.
 */
import { useEffect, useState } from "react";
import { useUI } from "@/lib/store/ui";
import {
  describeImagery,
  formatImageTime,
  geoSatelliteFor,
  type HiresProviderId,
  type ImageryTimes,
  type SatSourceId,
} from "@/lib/imagery";

const SOURCES: Array<{ id: SatSourceId; label: string; hint: string }> = [
  { id: "mosaic", label: "Best detail (mosaic)", hint: "Blue Marble → Sentinel-2 10 m → sub-metre aerial/satellite. Sharpest, but stitched from past captures." },
  { id: "live", label: "Live — geostationary (≈10 min)", hint: "GOES-East/West GeoColor and Himawari, new frame every 10 min. ~0.5–2 km per pixel; no coverage over Europe/Africa." },
  { id: "daily", label: "Daily — VIIRS (last full day)", hint: "NOAA-20 VIIRS true colour, one global composite per day (~375 m)." },
  { id: "night", label: "Night — VIIRS night band", hint: "Suomi NPP Day/Night Band from the last full day: city lights, fires, moonlit clouds." },
];

const HIRES: Array<{ id: HiresProviderId; label: string }> = [
  { id: "esri", label: "Esri" },
  { id: "usgs", label: "USGS (US)" },
  { id: "off", label: "Off" },
];

const IR_KEY = { goesEast: "goesEastIr", goesWest: "goesWestIr", himawari: "himawariIr" } as const;

export function ImageryPanel({
  view,
  times,
  timesError,
  loadingTimes,
}: {
  view: { zoom: number; lon: number };
  times: ImageryTimes | null;
  timesError: string | null;
  loadingTimes: boolean;
}) {
  const s = useUI((st) => st.settings);
  const update = useUI((st) => st.updateSettings);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);
  const [open, setOpen] = useState(true);
  const sat = s.mapStyle === "satellite";

  const d = sat ? describeImagery(s.satSource, view.zoom, view.lon, s.hiresProvider, times ?? {}, now) : null;
  const when = d ? formatImageTime(d.time, now) : null;
  const irSat = geoSatelliteFor(view.lon);
  const irTime = irSat && times ? formatImageTime(times[IR_KEY[irSat]] ?? null, now) : null;

  return (
    <div className="glass pointer-events-auto w-[250px] rounded-md px-3 py-2 text-[11px] leading-snug">
      <div className="flex items-center justify-between">
        <span className="meta text-faint">{sat ? "Satellite imagery" : "Clouds overlay"}</span>
        <button className="meta text-faint hover:text-fg" onClick={() => setOpen(!open)} aria-expanded={open} title={open ? "Collapse" : "Expand"}>
          {open ? "−" : "+"}
        </button>
      </div>

      {d && (
        <div className="mt-1">
          <div className="flex items-center gap-1.5">
            <span
              className={`meta rounded px-1 py-px ${d.live ? "bg-live/15 text-live" : "bg-white/5 text-muted"}`}
              title={d.live ? "Recent geostationary frame — see image time" : "Not live"}
            >
              {d.live ? "Near-real-time" : s.satSource === "daily" || s.satSource === "night" ? (d.time ? "Daily" : "Archive") : "Archive mosaic"}
            </span>
            <span className="truncate text-fg">{d.name}</span>
          </div>
          <div className="text-muted">
            {when ? <>Image time: {when} · </> : null}
            {d.resolution}
          </div>
          <div className="text-faint">{d.note}</div>
          {s.satSource !== "mosaic" && loadingTimes && <div className="text-faint">Checking latest image times…</div>}
          {s.satSource !== "mosaic" && timesError && !times && <div className="text-faint">Latest image times unavailable: {timesError}</div>}
        </div>
      )}

      {open && sat && (
        <fieldset className="mt-2 space-y-0.5 border-t border-line pt-1.5">
          <legend className="sr-only">Satellite source</legend>
          {SOURCES.map((o) => (
            <label key={o.id} className="flex cursor-pointer items-start gap-1.5 py-0.5" title={o.hint}>
              <input
                type="radio"
                name="sat-source"
                className="mt-0.5 accent-[var(--accent)]"
                checked={s.satSource === o.id}
                onChange={() => update({ satSource: o.id })}
              />
              <span className={s.satSource === o.id ? "text-fg" : "text-muted"}>{o.label}</span>
            </label>
          ))}
        </fieldset>
      )}

      {open && (
        <div className="mt-1.5 space-y-1 border-t border-line pt-1.5">
          {sat && (
            <>
              <label className="flex cursor-pointer items-center justify-between">
                <span className="text-muted">Roads &amp; labels</span>
                <input type="checkbox" checked={s.satLabels} onChange={(e) => update({ satLabels: e.target.checked })} />
              </label>
              <div className="flex items-center justify-between" title="Very-high-resolution mosaic tiles from zoom ~11. Esri: worldwide, sub-metre in many places (Esri terms, non-commercial use with attribution). USGS: United States only, public domain.">
                <span className="text-muted">Zoom detail</span>
                <div className="flex overflow-hidden rounded border border-line">
                  {HIRES.map((h) => (
                    <button
                      key={h.id}
                      onClick={() => update({ hiresProvider: h.id })}
                      aria-pressed={s.hiresProvider === h.id}
                      className={`px-1.5 py-px text-[10.5px] ${s.hiresProvider === h.id ? "bg-accent/20 text-fg" : "text-muted hover:text-fg"}`}
                    >
                      {h.label}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
          <label className="flex cursor-pointer items-center justify-between" title="Geostationary infrared (GOES-East/West, Himawari), semi-transparent: cold cloud tops show white. ~2 km per pixel, fades out when zoomed in.">
            <span className="text-muted">Clouds (infrared)</span>
            <input type="checkbox" checked={s.showClouds} onChange={(e) => update({ showClouds: e.target.checked })} />
          </label>
          {s.showClouds && (
            <div className="text-faint">
              {irSat ? `IR ${irTime ? `· ${irTime}` : "· checking time…"}` : "No keyless geostationary IR over Europe/Africa/W Asia"}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
