"use client";
/**
 * Viewer for one public camera. On open it asks /api/cameras/[id] for the camera's media,
 * then walks a fallback chain — live HLS → MP4 clip → still image → "offline" — moving on
 * as soon as a step fails or doesn't start within its timeout, so it never spins forever.
 * hls.js errors get one network restart (startLoad) and up to two media recoveries
 * (recoverMediaError, then with swapAudioCodec) before the stream counts as failed. The
 * header says which media type is showing. Nothing streams unless the viewer is open and
 * the page is visible; closing it stops the feed. Media loads directly from the operator.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useUI } from "@/lib/store/ui";
import { CloseIcon } from "@/components/ui/icons";
import { mediaPlan, pct, videoHealthy, type CameraMedia, type MediaStep } from "@/lib/cameras";

type Cam = NonNullable<ReturnType<typeof useUI.getState>["selectedCamera"]>;

/** Time allowed for each step to show something before trying the next. */
const START_TIMEOUT_MS: Record<MediaStep, number> = { hls: 12_000, mp4: 10_000, still: 10_000 };
const MEDIA_TIMEOUT_MS = 8_000;
/** A stream that stops mid-play gets this long to recover. */
const STALL_TIMEOUT_MS = 15_000;

type Phase = "connecting" | "showing" | "reconnecting";

const LABEL: Record<MediaStep, string> = { hls: "Live video", mp4: "Video clip", still: "Still image" };

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
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`;
}

async function fetchMedia(id: string): Promise<CameraMedia> {
  const res = await fetch(`/api/cameras/${encodeURIComponent(id)}`, { signal: AbortSignal.timeout(MEDIA_TIMEOUT_MS) });
  if (!res.ok) throw new Error(res.status === 404 ? "This camera is no longer listed by its operator." : `Camera details unavailable (${res.status})`);
  return res.json();
}

/** Loads an image off-screen; resolves with its URL once decoded, rejects on error or timeout. */
function preload(url: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.referrerPolicy = "no-referrer";
    const t = setTimeout(() => {
      img.src = "";
      reject(new Error("timed out"));
    }, timeoutMs);
    img.onload = () => {
      clearTimeout(t);
      if (img.naturalWidth > 0) resolve(url);
      else reject(new Error("empty image"));
    };
    img.onerror = () => {
      clearTimeout(t);
      reject(new Error("not available"));
    };
    img.src = url;
  });
}

const withBust = (url: string, n: number) => (n ? `${url}${url.includes("?") ? "&" : "?"}t=${Date.now()}` : url);

function Viewer({ cam }: { cam: Cam }) {
  const close = () => useUI.getState().selectCamera(null);
  const [id, name, lon, lat] = cam.row;
  const every = stillEvery(cam.source.refreshSec);
  const watching = usePageVisible();

  const [media, setMedia] = useState<CameraMedia | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);
  /** Steps that failed this session, with why. */
  const [failed, setFailed] = useState<Partial<Record<MediaStep, string>>>({});
  /** A step the user picked from the tabs. */
  const [picked, setPicked] = useState<MediaStep | null>(null);
  /** Bumped by "Retry" to start over. */
  const [attempt, setAttempt] = useState(0);
  const [phaseState, setPhaseState] = useState<{ key: string; phase: Phase }>({ key: "", phase: "connecting" });
  const [still, setStill] = useState<{ src: string; at: number } | null>(null);
  const [stillRefreshFailed, setStillRefreshFailed] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const video = useRef<HTMLVideoElement>(null);
  /** True unless the browser's own HLS player drives the video element (hls.js reports and recovers from its own errors). */
  const usingHlsJs = useRef(true);

  const plan = media ? mediaPlan(media, videoHealthy(cam.health)) : [];
  const step: MediaStep | "offline" | null = !media ? null : picked && !failed[picked] ? picked : (plan.find((s) => !failed[s]) ?? "offline");
  // Each step (and each retry) starts out "connecting".
  const phaseKey = `${step}|${attempt}`;
  const phase: Phase = phaseState.key === phaseKey ? phaseState.phase : "connecting";
  const setPhase = useCallback(
    (p: Phase | ((cur: Phase) => Phase)) =>
      setPhaseState((s) => {
        const cur = s.key === phaseKey ? s.phase : "connecting";
        return { key: phaseKey, phase: typeof p === "function" ? p(cur) : p };
      }),
    [phaseKey],
  );

  const fail = useCallback((s: MediaStep, why: string) => {
    setFailed((f) => (f[s] ? f : { ...f, [s]: why }));
    setPicked((p) => (p === s ? null : p));
  }, []);

  // Camera media from the server (with a timeout).
  useEffect(() => {
    let cancelled = false;
    fetchMedia(id)
      .then((m) => !cancelled && setMedia(m))
      .catch((e: Error) => !cancelled && setMediaError(e.name === "TimeoutError" ? "The server didn't answer in time." : e.message));
    return () => {
      cancelled = true;
    };
  }, [id, attempt]);


  // Start timeout for whichever step is showing (only while visible).
  useEffect(() => {
    if (!step || step === "offline" || phase !== "connecting" || !watching) return;
    const t = setTimeout(() => fail(step, "didn't start in time"), START_TIMEOUT_MS[step]);
    return () => clearTimeout(t);
  }, [step, phase, watching, attempt, fail]);

  // Stall watchdog: a stream that stops mid-play gets STALL_TIMEOUT_MS to come back.
  useEffect(() => {
    if (phase !== "reconnecting" || !step || step === "offline") return;
    const t = setTimeout(() => fail(step, "stopped and didn't recover"), STALL_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [phase, step, fail]);

  // HLS: hls.js (with error recovery) wherever Media Source is available — including Chrome, which
  // now also plays HLS natively but without any recovery — else the browser's own player (iOS
  // Safari). Torn down when hidden or closed.
  useEffect(() => {
    if (step !== "hls" || !watching || !media?.video || !video.current) return;
    const el = video.current;
    const url = media.video;
    let destroyed = false;
    let native = false;
    usingHlsJs.current = true;
    let hls: import("hls.js").default | null = null;
    const playNative = () => {
      if (!el.canPlayType("application/vnd.apple.mpegurl")) return fail("hls", "this browser can't play HLS");
      native = true;
      usingHlsJs.current = false;
      el.src = url;
      void el.play().catch(() => {});
    };
    import("hls.js")
      .then(({ default: Hls }) => {
        if (destroyed) return;
        if (!Hls.isSupported()) return playNative();
        const policy = (ttfb: number, load: number) => ({
          default: {
            maxTimeToFirstByteMs: ttfb,
            maxLoadTimeMs: load,
            timeoutRetry: { maxNumRetry: 1, retryDelayMs: 0, maxRetryDelayMs: 0 },
            errorRetry: { maxNumRetry: 1, retryDelayMs: 1000, maxRetryDelayMs: 2000 },
          },
        });
        const h = new Hls({
          lowLatencyMode: false,
          liveDurationInfinity: true,
          // On-demand stream servers can take a few seconds to start a camera nobody was watching,
          // but the viewer's own start timeout (12 s) is the overall limit.
          manifestLoadPolicy: policy(8_000, 10_000),
          playlistLoadPolicy: policy(8_000, 10_000),
        });
        hls = h;
        let netRestarts = 0;
        let mediaRecoveries = 0;
        h.on(Hls.Events.ERROR, (_e, data) => {
          if (!data.fatal) return;
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR && netRestarts < 1 && !String(data.details).startsWith("manifest")) {
            netRestarts++;
            setTimeout(() => !destroyed && h.startLoad(-1), 1000);
          } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR && mediaRecoveries < 2) {
            if (mediaRecoveries++ === 1) h.swapAudioCodec();
            h.recoverMediaError();
          } else {
            fail("hls", data.type === Hls.ErrorTypes.KEY_SYSTEM_ERROR ? "the stream is DRM-protected and can't play in this browser" : data.details === Hls.ErrorDetails.MANIFEST_LOAD_ERROR || data.details === Hls.ErrorDetails.MANIFEST_LOAD_TIMEOUT ? "the operator's stream server didn't respond" : `stream error (${data.details})`);
          }
        });
        h.loadSource(url);
        h.attachMedia(el);
        void el.play().catch(() => {});
      })
      .catch(() => !destroyed && playNative());
    return () => {
      destroyed = true;
      // Errors the element raises while being torn down aren't stream failures.
      usingHlsJs.current = true;
      hls?.destroy();
      if (native) {
        el.removeAttribute("src");
        el.load();
      }
    };
  }, [step, watching, media, attempt, fail]);

  // MP4 clip: play while visible.
  useEffect(() => {
    const el = video.current;
    if (step !== "mp4" || !el) return;
    if (watching) void el.play().catch(() => {});
    else el.pause();
  }, [step, watching]);

  // Stills: load off-screen (so a failed refresh keeps the last good frame), then re-fetch on the operator's cadence while visible.
  useEffect(() => {
    if (step !== "still" || !watching || !media?.image) return;
    let cancelled = false;
    let n = 0;
    const load = async () => {
      const first = n++ === 0 && !still;
      try {
        let url = media.image!;
        if (media.volatileImage && n > 1) url = (await fetchMedia(id)).image ?? url;
        const src = await preload(withBust(url, media.volatileImage ? 0 : n - 1), first ? START_TIMEOUT_MS.still : 20_000);
        if (cancelled) return;
        setStill({ src, at: Date.now() });
        setStillRefreshFailed(false);
        setPhase("showing");
      } catch (e) {
        if (cancelled) return;
        if (first) fail("still", e instanceof Error && e.message === "timed out" ? "didn't load in time" : "the operator's image isn't available");
        else setStillRefreshFailed(true);
      }
    };
    void load();
    const t = setInterval(load, every * 1000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
    // `still` is read only to know whether a frame is already showing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, watching, media, every, attempt, id, fail, setPhase]);

  // "Updated Xs ago" clock (also only while visible).
  useEffect(() => {
    if (!watching) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [watching]);

  const retry = () => {
    setFailed({});
    setPicked(null);
    setMediaError(null);
    setAttempt((n) => n + 1);
  };

  const fellBack = plan.filter((s) => failed[s]);
  const offline = step === "offline" || !!mediaError;
  const badge = !watching
    ? "Paused — not visible"
    : mediaError || step === "offline"
      ? "Offline"
      : !step
        ? "Connecting…"
        : step === "still"
          ? `Still image · refreshes every ${every}s`
          : `${step === "hls" ? "Live video · HLS" : "Video clip · MP4"}${phase === "connecting" ? " · connecting…" : phase === "reconnecting" ? " · reconnecting…" : ""}`;
  const color = !watching || offline ? "var(--text-faint)" : "#2ec4b6";
  const h = cam.health;

  return (
    <div className="glass absolute top-[76px] left-3 z-20 w-[min(380px,calc(100%-24px))] overflow-hidden rounded-lg shadow-2xl shadow-black/60" role="dialog" aria-label={`Camera: ${name}`} data-media={offline ? "offline" : (step ?? "loading")} data-phase={phase}>
      <div className="flex items-start justify-between gap-2 px-3 pt-2.5 pb-2">
        <div className="min-w-0">
          <div className="meta flex items-center gap-1.5" style={{ color }}>
            <span className={watching && !offline && phase === "showing" ? "live-dot h-1.5 w-1.5 rounded-full" : "h-1.5 w-1.5 rounded-full"} style={{ background: color }} />
            {badge} · {cam.source.region}
          </div>
          <div className="mt-0.5 truncate text-[13px] font-medium" title={name}>{name}</div>
        </div>
        <button onClick={close} className="rounded p-1 text-muted hover:bg-panel-hover hover:text-fg" aria-label="Close camera (stops the feed)">
          <CloseIcon />
        </button>
      </div>
      {plan.length > 1 && (
        <div className="flex gap-1 px-3 pb-1.5" role="tablist">
          {plan.map((s) => (
            <button
              key={s}
              role="tab"
              aria-selected={step === s}
              title={failed[s] ? `Failed: ${failed[s]} — click to try again` : undefined}
              onClick={() => {
                setFailed((f) => Object.fromEntries(Object.entries(f).filter(([k]) => k !== s)));
                setPicked(s);
              }}
              className={`rounded px-2 py-0.5 text-[11px] ${step === s ? "bg-panel-hover text-fg" : "text-muted hover:text-fg"} ${failed[s] ? "line-through opacity-60" : ""}`}
            >
              {LABEL[s]}
            </button>
          ))}
        </div>
      )}
      <div className="relative aspect-video bg-black">
        {offline ? (
          <div className="grid h-full place-items-center px-6 text-center text-[12px] text-muted">
            <div>
              <div className="text-fg">Camera offline right now</div>
              {mediaError ?? (plan.length ? `Tried ${plan.map((s) => `${LABEL[s].toLowerCase()} (${failed[s] ?? "failed"})`).join(", ")}.` : "The operator publishes no media for this camera.")}
              <div>
                <button onClick={retry} className="mt-2 rounded px-2 py-0.5 text-[11px] text-fg hover:bg-panel-hover">
                  Retry
                </button>
              </div>
            </div>
          </div>
        ) : step === "still" ? (
          still ? (
            // eslint-disable-next-line @next/next/no-img-element -- live image from the operator, not an app asset
            <img src={still.src} alt={`Latest image from ${name}`} className="h-full w-full object-contain" referrerPolicy="no-referrer" />
          ) : (
            <Spinner />
          )
        ) : step === "hls" || step === "mp4" ? (
          <>
            {watching && (
              <video
                ref={video}
                key={`${id}-${step}-${attempt}`}
                src={step === "mp4" ? (media?.video ?? undefined) : undefined}
                // The still (when there is one) shows while the stream connects.
                poster={media?.image && !media.volatileImage ? media.image : undefined}
                className="h-full w-full object-contain"
                autoPlay
                muted
                playsInline
                controls
                loop={step === "mp4"}
                onPlaying={() => setPhase("showing")}
                onWaiting={() => setPhase((p) => (p === "showing" ? "reconnecting" : p))}
                onError={() => {
                  if (step === "mp4") fail("mp4", "the clip isn't available");
                  // hls.js reports (and recovers from) its own errors; only native HLS (Safari) fails here.
                  else if (!usingHlsJs.current) fail("hls", "the stream isn't available");
                }}
              />
            )}
            {phase !== "showing" && watching && <Spinner overlay />}
          </>
        ) : (
          <Spinner />
        )}
        {!watching && <div className="absolute inset-0 grid place-items-center bg-black/60 text-[12px] text-muted">Paused while this tab isn&apos;t visible</div>}
      </div>
      <div className="px-3 py-2 text-[10.5px] leading-snug text-faint">
        {cam.source.name} · {lat.toFixed(4)}, {lon.toFixed(4)}
        {step === "still" && still && ` · image loaded ${ago(now - still.at)}`}
        {step === "still" && stillRefreshFailed && " · latest refresh failed, showing the last image"}
        {!offline && fellBack.length > 0 && (step === "hls" || step === "mp4" || step === "still") && ` · ${fellBack.map((s) => `${LABEL[s].toLowerCase()}: ${failed[s]}`).join("; ")} — showing the ${LABEL[step].toLowerCase()}`}
        {media && !media.image && " · video only (the operator publishes no still image)"}
        {h && (
          <>
            <br />
            Operator check {ago(now - Date.parse(h.checkedAt))}: {[h.stillN ? `${pct(h.stillOk, h.stillN)}% of sampled images` : "", h.videoN ? `${pct(h.videoOk, h.videoN)}% of sampled streams` : ""].filter(Boolean).join(", ")} responded.
          </>
        )}
        <br />
        The feed only runs while this viewer is open and visible. Published by the operator for public viewing ({cam.source.license}).{" "}
        <a href={cam.source.homepage} target="_blank" rel="noreferrer" className="underline hover:text-fg">
          Source
        </a>
      </div>
    </div>
  );
}

function Spinner({ overlay }: { overlay?: boolean }) {
  return (
    <div className={`${overlay ? "pointer-events-none absolute inset-0" : "h-full"} grid place-items-center text-[12px] text-muted`} role="status">
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/20 border-t-white/70" aria-label="Loading" />
    </div>
  );
}
