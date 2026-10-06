"use client";
/**
 * Viewer for one public camera: the operator's latest still image (refreshed on
 * the operator's schedule) or its video stream (MP4 clip / HLS live stream).
 * Media loads directly from the operator's servers.
 */
import { useEffect, useRef, useState } from "react";
import { useUI } from "@/lib/store/ui";
import { CloseIcon } from "@/components/ui/icons";

type Cam = NonNullable<ReturnType<typeof useUI.getState>["selectedCamera"]>;

export function CameraViewer() {
  const cam = useUI((s) => s.selectedCamera);
  // Keyed by camera so each camera starts fresh (still image, no errors).
  return cam ? <Viewer key={cam.row[0]} cam={cam} /> : null;
}

function Viewer({ cam }: { cam: Cam }) {
  const close = () => useUI.getState().selectCamera(null);
  const [tick, setTick] = useState(0);
  const [mode, setMode] = useState<"image" | "video">("image");
  const [imgError, setImgError] = useState(false);
  const [videoError, setVideoError] = useState<string | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const id = cam.row[0];

  // Refresh the still on the operator's update cadence (at least every 15 s, at most every 5 min).
  useEffect(() => {
    if (mode !== "image") return;
    const every = Math.min(300, Math.max(15, cam.source.refreshSec)) * 1000;
    const t = setInterval(() => setTick((n) => n + 1), every);
    return () => clearInterval(t);
  }, [cam, mode]);

  // HLS: native where supported (Safari), else hls.js.
  useEffect(() => {
    if (mode !== "video" || cam.row[7] !== "hls" || !video.current || !cam.row[6]) return;
    const el = video.current;
    const url = cam.row[6];
    if (el.canPlayType("application/vnd.apple.mpegurl")) {
      el.src = url;
      return;
    }
    let destroyed = false;
    let hls: { destroy: () => void } | null = null;
    import("hls.js").then(({ default: Hls }) => {
      if (destroyed) return;
      if (!Hls.isSupported()) {
        setVideoError("This browser can't play the stream.");
        return;
      }
      const h = new Hls({ lowLatencyMode: true });
      h.on(Hls.Events.ERROR, (_e, data) => data.fatal && setVideoError("The live stream is unavailable right now."));
      h.loadSource(url);
      h.attachMedia(el);
      hls = h;
    });
    return () => {
      destroyed = true;
      hls?.destroy();
    };
  }, [cam, mode]);

  const [, name, lon, lat, , imageUrl, videoUrl, videoKind] = cam.row;
  const sep = imageUrl.includes("?") ? "&" : "?";
  const src = tick ? `${imageUrl}${sep}t=${tick}` : imageUrl;

  return (
    <div className="glass absolute top-3 left-3 z-20 w-[380px] overflow-hidden rounded-lg shadow-2xl shadow-black/60" role="dialog" aria-label={`Camera: ${name}`}>
      <div className="flex items-start justify-between gap-2 px-3 pt-2.5 pb-2">
        <div className="min-w-0">
          <div className="meta flex items-center gap-1.5" style={{ color: "#2ec4b6" }}>
            <span className="live-dot h-1.5 w-1.5 rounded-full" style={{ background: "#2ec4b6" }} /> Live camera · {cam.source.region}
          </div>
          <div className="mt-0.5 truncate text-[13px] font-medium" title={name}>{name}</div>
        </div>
        <button onClick={close} className="rounded p-1 text-muted hover:bg-panel-hover hover:text-fg" aria-label="Close camera">
          <CloseIcon />
        </button>
      </div>
      {videoUrl && (
        <div className="flex gap-1 px-3 pb-1.5" role="tablist">
          {(["image", "video"] as const).map((m) => (
            <button key={m} role="tab" aria-selected={mode === m} onClick={() => setMode(m)} className={`rounded px-2 py-0.5 text-[11px] ${mode === m ? "bg-panel-hover text-fg" : "text-muted hover:text-fg"}`}>
              {m === "image" ? "Latest image" : videoKind === "hls" ? "Live video" : "Video clip"}
            </button>
          ))}
        </div>
      )}
      <div className="relative aspect-video bg-black">
        {mode === "image" ? (
          imgError ? (
            <div className="grid h-full place-items-center px-6 text-center text-[12px] text-muted">The operator&apos;s image isn&apos;t available right now.</div>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element -- live image from the operator, not an app asset
            <img src={src} alt={`Latest image from ${name}`} className="h-full w-full object-contain" referrerPolicy="no-referrer" onError={() => setImgError(true)} onLoad={() => setImgError(false)} />
          )
        ) : videoError ? (
          <div className="grid h-full place-items-center px-6 text-center text-[12px] text-muted">{videoError}</div>
        ) : (
          <video
            ref={video}
            key={`${id}-video`}
            src={videoKind === "mp4" ? (videoUrl ?? undefined) : undefined}
            className="h-full w-full object-contain"
            autoPlay
            muted
            playsInline
            controls
            loop={videoKind === "mp4"}
            onError={() => setVideoError("The video isn't available right now.")}
          />
        )}
      </div>
      <div className="px-3 py-2 text-[10.5px] leading-snug text-faint">
        {cam.source.name} · {lat.toFixed(4)}, {lon.toFixed(4)}
        {mode === "image" && ` · image refreshes every ${Math.min(300, Math.max(15, cam.source.refreshSec))} s`}
        <br />
        Published by the operator for public viewing ({cam.source.license}).{" "}
        <a href={cam.source.homepage} target="_blank" rel="noreferrer" className="underline hover:text-fg">Source</a>
      </div>
    </div>
  );
}
