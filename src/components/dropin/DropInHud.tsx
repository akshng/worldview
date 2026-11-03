"use client";
/**
 * On-map controls for the street-level "drop in" view: exit, rotate, tilt,
 * orbit, place name, coordinates and ground elevation, plus nearby photos.
 */
import { useEffect, useState } from "react";
import type { Map as MlMap } from "maplibre-gl";
import { useUI } from "@/lib/store/ui";
import { idleOnBattery, onBattery } from "@/lib/client/power";
import { TERRAIN_EXAGGERATION } from "@/components/globe/style";
import { DROP_MAX_PITCH, formatCoords, formatElevation, nearestLocalPlace, normalizeBearing, orbitStep } from "./logic";
import { DropInPhotos } from "./DropInPhotos";

interface Reverse {
  near: string | null;
  country: string | null;
}

export function DropInHud({ map, panelOpen = false }: { map: MlMap; panelOpen?: boolean }) {
  const view = useUI((s) => s.dropInView);
  const [cam, setCam] = useState(() => ({ pitch: map.getPitch(), bearing: map.getBearing() }));
  const [here, setHere] = useState<{ lat: number; lon: number; elev: string | null } | null>(null);
  const [orbit, setOrbit] = useState(false);
  const [reverse, setReverse] = useState<{ key: string; data: Reverse | null; local: string | null } | null>(null);
  const key = view ? `${view.lat.toFixed(5)},${view.lon.toFixed(5)}` : "";

  // ---- camera readouts ---------------------------------------------------------
  useEffect(() => {
    let raf = 0;
    const onCam = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setCam({ pitch: map.getPitch(), bearing: map.getBearing() }));
    };
    const onSettle = () => {
      const c = map.getCenter();
      setHere({ lat: c.lat, lon: c.lng, elev: formatElevation(map.queryTerrainElevation(c), TERRAIN_EXAGGERATION) });
    };
    map.on("rotate", onCam);
    map.on("pitch", onCam);
    map.on("moveend", onSettle);
    // Terrain tiles arrive after the flight: refresh the elevation once they have.
    map.on("idle", onSettle);
    return () => {
      cancelAnimationFrame(raf);
      map.off("rotate", onCam);
      map.off("pitch", onCam);
      map.off("moveend", onSettle);
      map.off("idle", onSettle);
    };
  }, [map]);

  // ---- place name: offline gazetteer (server) + the most local OSM place in the loaded tiles ----
  useEffect(() => {
    if (!view) return;
    const ctrl = new AbortController();
    let local: string | null = null;
    let data: Reverse | null = null;
    const publish = () => setReverse({ key, data, local });
    fetch(`/api/geocode/reverse?lat=${view.lat.toFixed(5)}&lon=${view.lon.toFixed(5)}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? (r.json() as Promise<Reverse>) : null))
      .then((d) => {
        data = d;
        publish();
      })
      .catch(() => {});
    const findLocal = () => {
      if (ctrl.signal.aborted || !map.getSource("omt")) return;
      const feats = map.querySourceFeatures("omt", { sourceLayer: "place" });
      local = nearestLocalPlace(
        feats
          .filter((f) => f.geometry.type === "Point")
          .map((f) => {
            const [lon, lat] = (f.geometry as GeoJSON.Point).coordinates;
            const p = f.properties as Record<string, string | undefined>;
            return { name: p["name:en"] ?? p.name_en ?? p.name, cls: p.class, lat, lon };
          }),
        view,
      );
      if (local) publish();
    };
    map.once("idle", findLocal);
    return () => {
      ctrl.abort();
      map.off("idle", findLocal);
    };
  }, [view, key, map]);

  // ---- orbit: slow bearing rotation; any user input, blur or hidden tab stops it ----
  useEffect(() => {
    if (!orbit || !view) return;
    let raf = 0;
    let last = performance.now();
    const stop = () => setOrbit(false);
    const frame = (t: number) => {
      if (document.hidden || !document.hasFocus() || idleOnBattery()) return stop();
      // On battery: ~15 fps is plenty for a slow pan and saves the GPU.
      if (!onBattery() || t - last >= 66) {
        map.setBearing(orbitStep(map.getBearing(), t - last));
        last = t;
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    const el = map.getCanvasContainer();
    const opts = { passive: true } as const;
    el.addEventListener("pointerdown", stop, opts);
    el.addEventListener("wheel", stop, opts);
    el.addEventListener("touchstart", stop, opts);
    window.addEventListener("keydown", stop);
    window.addEventListener("blur", stop);
    document.addEventListener("visibilitychange", stop);
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener("pointerdown", stop);
      el.removeEventListener("wheel", stop);
      el.removeEventListener("touchstart", stop);
      window.removeEventListener("keydown", stop);
      window.removeEventListener("blur", stop);
      document.removeEventListener("visibilitychange", stop);
    };
  }, [orbit, view, map]);

  if (!view) return null;
  const rev = reverse?.key === key ? reverse : null;
  const title = rev?.local ?? rev?.data?.near ?? "Street view";
  const sub = [rev?.local ? rev?.data?.near : null, rev?.data?.country && !rev?.data?.near?.includes(rev.data.country) ? rev.data.country : null]
    .filter(Boolean)
    .join(" · ");
  const rotate = (deg: number) => map.easeTo({ bearing: normalizeBearing(map.getBearing() + deg), duration: 450 });

  return (
    <>
      <div
        // A detail panel floats over the right edge: sit beside it instead of centred.
        className={`glass pointer-events-auto absolute top-[76px] z-10 flex flex-col ${panelOpen ? "left-3 w-[min(520px,calc(100%-436px))]" : "left-1/2 w-[min(560px,calc(100%-24px))] -translate-x-1/2"} gap-2 rounded-md px-3 py-2 shadow-2xl shadow-black/50`}
        data-dropin-hud
        role="region"
        aria-label="Street-level view controls"
      >
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-semibold text-fg" title={title}>
              {title}
            </div>
            {sub && <div className="truncate text-[11.5px] text-muted">{sub}</div>}
            <div className="meta truncate normal-case tracking-normal text-faint">
              {here ? formatCoords(here.lat, here.lon) : formatCoords(view.lat, view.lon)}
              {here?.elev ? ` · ground ${here.elev} above sea level` : ""}
            </div>
          </div>
          <button
            onClick={() => useUI.getState().exitDropIn()}
            title="Fly back out to the globe (Esc)"
            className="shrink-0 rounded border border-line px-2.5 py-1 text-[12px] text-fg hover:bg-panel-hover"
          >
            Exit to globe
          </button>
        </div>
        <div className="flex items-center gap-2 text-[12px] text-muted">
          <HudButton title="Rotate left (Q)" onClick={() => rotate(-30)}>
            <RotateIcon />
          </HudButton>
          <HudButton title="Rotate right (E)" onClick={() => rotate(30)}>
            <RotateIcon flip />
          </HudButton>
          <HudButton title="Face north" onClick={() => map.easeTo({ bearing: 0, duration: 450 })}>
            <span style={{ display: "inline-block", transform: `rotate(${-cam.bearing}deg)` }}>N</span>
          </HudButton>
          <label className="flex min-w-0 flex-1 items-center gap-2" title="Tilt (or right-drag / ctrl-drag on the map)">
            <span className="meta shrink-0 normal-case tracking-normal">Tilt</span>
            <input
              type="range"
              min={0}
              max={DROP_MAX_PITCH}
              step={1}
              value={Math.round(cam.pitch)}
              onChange={(e) => map.jumpTo({ pitch: Number(e.target.value) })}
              className="min-w-0 flex-1 accent-accent"
              aria-label="Camera tilt"
            />
            <span className="meta w-7 shrink-0 text-right normal-case tracking-normal">{Math.round(cam.pitch)}°</span>
          </label>
          <button
            onClick={() => setOrbit(!orbit)}
            aria-pressed={orbit}
            title={orbit ? "Stop orbiting" : "Slowly orbit around the view centre (stops when you touch the map)"}
            className={`shrink-0 rounded border px-2 py-0.5 ${orbit ? "border-accent bg-accent/20 text-fg" : "border-line hover:bg-panel-hover hover:text-fg"}`}
          >
            Orbit
          </button>
        </div>
        <div className="meta normal-case tracking-normal text-faint">
          Drag to move · right-drag or ctrl-drag to tilt and turn · arrows pan · Q/E rotate · Esc exits
        </div>
      </div>
      <DropInPhotos lat={view.lat} lon={view.lon} panelOpen={panelOpen} />
    </>
  );
}

const RotateIcon = ({ flip }: { flip?: boolean }) => (
  <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden style={flip ? { transform: "scaleX(-1)" } : undefined}>
    <path d="M4 12a8 8 0 1 0 2.6-5.9" />
    <path d="M4 3.5V8h4.5" />
  </svg>
);

function HudButton({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      title={title}
      aria-label={title}
      onClick={onClick}
      className="grid h-6 w-6 shrink-0 place-items-center rounded border border-line text-[13px] leading-none hover:bg-panel-hover hover:text-fg"
    >
      {children}
    </button>
  );
}

/** "Click anywhere to drop in · Esc to cancel" */
export function DropInPickHint() {
  const picking = useUI((s) => s.dropInPicking);
  if (!picking) return null;
  return (
    <div className="glass pointer-events-auto absolute top-[76px] left-1/2 z-10 flex -translate-x-1/2 items-center gap-3 rounded-md px-3 py-1.5 text-[12.5px] text-fg shadow-xl shadow-black/40">
      <PersonPinIcon width={15} height={15} />
      <span>Click anywhere to drop in · Esc to cancel</span>
      <button className="text-muted hover:text-fg" onClick={() => useUI.getState().setDropInPicking(false)} aria-label="Cancel drop in">
        ✕
      </button>
    </div>
  );
}

/** Right-click menu on the map. */
export function DropInContextMenu({ x, y, lon, lat, onClose }: { x: number; y: number; lon: number; lat: number; onClose: () => void }) {
  useEffect(() => {
    const close = (e: Event) => {
      if (e.type === "keydown" && (e as KeyboardEvent).key !== "Escape") return;
      if (e.type === "pointerdown" && (e.target as HTMLElement).closest("[data-dropin-menu]")) return;
      onClose();
    };
    window.addEventListener("pointerdown", close, true);
    window.addEventListener("keydown", close, true);
    window.addEventListener("wheel", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("pointerdown", close, true);
      window.removeEventListener("keydown", close, true);
      window.removeEventListener("wheel", close, true);
      window.removeEventListener("resize", close);
    };
  }, [onClose]);
  const coords = `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
  return (
    <div
      data-dropin-menu
      role="menu"
      aria-label="Map actions"
      className="glass panel-in absolute z-20 min-w-[180px] rounded-md py-1 text-[12.5px] shadow-2xl shadow-black/50"
      style={{ left: x, top: y }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <button
        role="menuitem"
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-fg hover:bg-panel-hover"
        onClick={() => {
          useUI.getState().dropIn({ lon, lat });
          onClose();
        }}
      >
        <PersonPinIcon width={14} height={14} />
        Drop in here
      </button>
      <button
        role="menuitem"
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-muted hover:bg-panel-hover hover:text-fg"
        onClick={() => {
          void navigator.clipboard?.writeText(coords).catch(() => {});
          onClose();
        }}
      >
        <span className="w-[14px] text-center">⧉</span>
        Copy {coords}
      </button>
    </div>
  );
}

/** Person standing on a map pin. */
export const PersonPinIcon = (p: React.SVGProps<SVGSVGElement>) => (
  <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden {...p}>
    <circle cx="12" cy="4.2" r="2.1" />
    <path d="M12 7.4v6.4M9 10.2l3-1.6 3 1.6M10.2 19.2 12 13.8l1.8 5.4" />
    <ellipse cx="12" cy="20.6" rx="5.5" ry="1.6" />
  </svg>
);
