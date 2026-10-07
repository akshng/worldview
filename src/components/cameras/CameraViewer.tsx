"use client";
/**
 * Viewer for one public camera. Live first: opens straight into the camera's
 * video (HLS live stream / MP4 clip) when it has one, otherwise a still image
 * re-fetched on the operator's cadence. Video-only cameras (no still published)
 * have no still tab; if their stream fails the viewer says so. Nothing streams unless the viewer is open
 * and the page is visible; closing it stops the feed. Media loads directly from
 * the operator's servers.
 */
import { useEffect, useRef, useState } from "react";
import { useUI } from "@/lib/store/ui";
import { CloseIcon } from "@/components/ui/icons";

type Cam = NonNullable<ReturnType<typeof useUI.getState>["selectedCamera"]>;

export function CameraViewer() {
  const cam = useUI((s) => s.selectedCamera);
  // Keyed by camera so each camera starts fresh.
  return cam ? <Viewer key={cam.row[0]} cam={cam} /> : null;
}

/** True while the page is visible (tab in front, window not minimised). */
function usePageVisible(): boolean {
  const [visible, setVisible] = useState(() => typeof document === "undefined" || document.visibilityState === "visible");
  useEffect(() => {
    const on = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, []);
  return visible;
}

/** How often to re-fetch a still: the operator's cadence, between 3 s and 5 min. */
const stillEvery = (sec: number) => Math.min(300, Math.max(3, sec));

function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s}s ago` : `${Math.round(s / 60)} min ago`;
}

function Viewer({ cam }: { cam: Cam }) {
  const close = () => useUI.getState().selectCamera(null);
  const [, name, lon, lat, , imageUrl, videoUrl, videoKind] = cam.row;
  const hasStill = !!imageUrl;
  // Live first: open straight into video when the camera has it.
  const [mode, setMode] = useState<"image" | "video">(videoUrl ? "video" : "image");
  const [tick, setTick] = useState(0);
  const [imgError, setImgError] = useState(false);
  const [videoError, setVideoError] = useState<string | null>(null);
  /** Bumped by "Retry" to restart the stream. */
  const [attempt, setAttempt] = useState(0);
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const watching = usePageVisible();
  const video = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<{ stopLoad: () => void; startLoad: (pos?: number) => void; liveSyncPosition?: number | null } | null>(null);
  const id = cam.row[0];
  const every = stillEvery(cam.source.refreshSec);

  // A camera whose stream fails falls back to its auto-refreshing still image; a video-only camera shows the error.
  const failVideo = (msg: string) => {
    setVideoError(msg);
    if (hasStill) setMode("image");
  };

  // Still images: re-fetch on the operator's cadence, only while someone is looking.
  useEffect(() => {
    if (mode !== "image" || !watching) return;
    // Catch up straight away when returning to the tab, then keep the operator's cadence.
    const first = setTimeout(() => setTick((n) => n + 1), 0);
    const t = setInterval(() => setTick((n) => n + 1), every * 1000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [mode, watching, every]);

  // "Updated Xs ago" clock (also only while visible).
  useEffect(() => {
    if (!watching) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [watching]);

  // HLS: native where supported (Safari), else hls.js. Destroyed on close / camera change.
  useEffect(() => {
    if (mode !== "video" || videoKind !== "hls" || !video.current || !videoUrl) return;
    const el = video.current;
    if (el.canPlayType("application/vnd.apple.mpegurl")) {
      el.src = videoUrl;
      return () => {
        el.removeAttribute("src");
        el.load();
      };
    }
    let destroyed = false;
    let hls: { destroy: () => void } | null = null;
    import("hls.js").then(({ default: Hls }) => {
      if (destroyed) return;
      if (!Hls.isSupported()) {
        failVideo("This browser can't play the stream.");
        return;
      }
      // Operators' streams are plain live HLS. Retry the playlist a couple of times: on-demand stream
      // servers can take a few seconds to start a camera nobody was watching.
      const h = new Hls({
        lowLatencyMode: false,
        liveDurationInfinity: true,
        manifestLoadPolicy: {
          default: {
            maxTimeToFirstByteMs: 15_000,
            maxLoadTimeMs: 20_000,
            timeoutRetry: { maxNumRetry: 2, retryDelayMs: 0, maxRetryDelayMs: 0 },
            errorRetry: { maxNumRetry: 2, retryDelayMs: 1500, maxRetryDelayMs: 4000 },
          },
        },
      });
      h.on(Hls.Events.ERROR, (_e, data) => data.fatal && failVideo("Stream unavailable right now."));
      h.loadSource(videoUrl);
      h.attachMedia(el);
      hls = h;
      hlsRef.current = h;
    });
    return () => {
      destroyed = true;
      hls?.destroy();
      hlsRef.current = null;
    };
  }, [mode, videoKind, videoUrl, attempt]);

  // Pause video (and stop downloading the stream) while the page isn't visible; jump back to live on return.
  useEffect(() => {
    const el = video.current;
    if (mode !== "video" || !el || videoError) return;
    if (!watching) {
      el.pause();
      hlsRef.current?.stopLoad();
      return;
    }
    const h = hlsRef.current;
    if (h) {
      h.startLoad(-1);
      if (typeof h.liveSyncPosition === "number") el.currentTime = h.liveSyncPosition;
    }
    void el.play().catch(() => {});
  }, [watching, mode, videoError]);


  const sep = imageUrl.includes("?") ? "&" : "?";
  const src = tick > 1 ? `${imageUrl}${sep}t=${tick}` : imageUrl;
  const isLiveVideo = mode === "video" && videoKind === "hls";
  const status = !watching
    ? "Paused — not visible"
    : mode === "video"
      ? videoError
        ? "Stream unavailable"
        : isLiveVideo
          ? "Live video"
          : "Video clip"
      : `Live image · refreshes every ${every}s`;

  return (
    <div className="glass absolute top-[76px] left-3 z-20 w-[min(380px,calc(100%-24px))] overflow-hidden rounded-lg shadow-2xl shadow-black/60" role="dialog" aria-label={`Camera: ${name}`}>
      <div className="flex items-start justify-between gap-2 px-3 pt-2.5 pb-2">
        <div className="min-w-0">
          <div className="meta flex items-center gap-1.5" style={{ color: watching ? "#2ec4b6" : "var(--text-faint)" }}>
            <span className={watching ? "live-dot h-1.5 w-1.5 rounded-full" : "h-1.5 w-1.5 rounded-full"} style={{ background: watching ? "#2ec4b6" : "var(--text-faint)" }} />
            {status} · {cam.source.region}
          </div>
          <div className="mt-0.5 truncate text-[13px] font-medium" title={name}>{name}</div>
        </div>
        <button onClick={close} className="rounded p-1 text-muted hover:bg-panel-hover hover:text-fg" aria-label="Close camera (stops the feed)">
          <CloseIcon />
        </button>
      </div>
      {videoUrl && hasStill && (
        <div className="flex gap-1 px-3 pb-1.5" role="tablist">
          {(["video", "image"] as const).map((m) => (
            <button key={m} role="tab" aria-selected={mode === m} onClick={() => { setVideoError(null); setMode(m); }} className={`rounded px-2 py-0.5 text-[11px] ${mode === m ? "bg-panel-hover text-fg" : "text-muted hover:text-fg"}`}>
              {m === "image" ? "Still image" : videoKind === "hls" ? "Live video" : "Video clip"}
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
            <img
              src={src}
              alt={`Latest image from ${name}`}
              className="h-full w-full object-contain"
              referrerPolicy="no-referrer"
              onError={() => setImgError(true)}
              onLoad={() => {
                setImgError(false);
                setLoadedAt(Date.now());
              }}
            />
          )
        ) : videoError && !hasStill ? (
          <div className="grid h-full place-items-center px-6 text-center text-[12px] text-muted">
            <div>
              <div className="text-fg">Stream unavailable</div>
              {videoError === "Stream unavailable right now." ? "The operator's live feed for this camera isn't responding." : videoError}
              <div>
                <button
                  onClick={() => {
                    setVideoError(null);
                    setAttempt((n) => n + 1);
                  }}
                  className="mt-2 rounded px-2 py-0.5 text-[11px] text-fg hover:bg-panel-hover"
                >
                  Retry
                </button>
              </div>
            </div>
          </div>
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
            onError={() => failVideo("Stream unavailable right now.")}
          />
        )}
        {!watching && <div className="absolute inset-0 grid place-items-center bg-black/60 text-[12px] text-muted">Paused while this tab isn&apos;t visible</div>}
      </div>
      <div className="px-3 py-2 text-[10.5px] leading-snug text-faint">
        {cam.source.name} · {lat.toFixed(4)}, {lon.toFixed(4)}
        {mode === "image" && loadedAt && ` · image loaded ${ago(now - loadedAt)}`}
        {videoError && mode === "image" && " · live video unavailable, showing the still image"}
        {!hasStill && " · live video only (the operator publishes no still image)"}
        <br />
        The feed only runs while this viewer is open and visible. Published by the operator for public viewing ({cam.source.license}).{" "}
        <a href={cam.source.homepage} target="_blank" rel="noreferrer" className="underline hover:text-fg">Source</a>
      </div>
    </div>
  );
}
