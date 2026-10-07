import { describe, expect, it } from "vitest";
import {
  CAM_HLS,
  CAM_LIVE,
  CAM_MP4,
  CAM_STILL,
  cameraFlags,
  deadSources,
  firstVariant,
  hasDrm,
  hasLive,
  isPlaylist,
  mediaPlan,
  sample,
  sourceDead,
  summarizeProbes,
  videoHealthy,
  type SourceHealth,
} from "@/lib/cameras";
import { CAMERA_SOURCES, findCamera, presentCameras, type CameraRow, type CamerasFull } from "@/layers/cameras";
import { probeTargets, runProbes } from "@/layers/cameras/health";

const at = "2026-10-07T00:00:00Z";
const h = (stillOk: number, stillN: number, videoOk: number, videoN: number): SourceHealth => ({ stillOk, stillN, videoOk, videoN, checkedAt: at });
const idx = (id: string) => CAMERA_SOURCES.findIndex((s) => s.id === id);

describe("camera flags", () => {
  it("encode still / HLS / MP4 and flag live only on healthy streams", () => {
    expect(cameraFlags("https://a/1.jpg", null, null, true)).toBe(CAM_STILL);
    expect(cameraFlags("https://a/1.jpg", "https://a/1.m3u8", "hls", true)).toBe(CAM_STILL | CAM_HLS | CAM_LIVE);
    expect(cameraFlags("https://a/1.jpg", "https://a/1.m3u8", "hls", false)).toBe(CAM_STILL | CAM_HLS);
    expect(cameraFlags("", "https://a/1.m3u8", "hls", true)).toBe(CAM_HLS | CAM_LIVE);
    expect(cameraFlags("https://a/1.jpg", "https://a/1.mp4", "mp4", true)).toBe(CAM_STILL | CAM_MP4);
    expect(hasLive(["x", "x", 0, 0, 0, CAM_HLS])).toBe(false);
    expect(hasLive(["x", "x", 0, 0, 0, CAM_HLS | CAM_LIVE])).toBe(true);
  });
});

describe("source health", () => {
  it("treats unknown or under-sampled sources as healthy", () => {
    expect(videoHealthy(undefined)).toBe(true);
    expect(videoHealthy(h(6, 6, 0, 2))).toBe(true);
    expect(videoHealthy(h(6, 6, 3, 6))).toBe(true);
    expect(videoHealthy(h(6, 6, 2, 6))).toBe(false);
  });

  it("calls a source dead only when every sample failed", () => {
    expect(sourceDead(h(0, 6, 0, 6))).toBe(true);
    expect(sourceDead(h(0, 0, 0, 6))).toBe(true);
    expect(sourceDead(h(1, 6, 0, 6))).toBe(false);
    expect(sourceDead(h(0, 2, 0, 0))).toBe(false);
    expect(sourceDead(undefined)).toBe(false);
  });

  it("hides dead sources, but nothing when most look dead (our network, not theirs)", () => {
    expect(deadSources({ a: h(0, 6, 0, 0), b: h(6, 6, 0, 0), c: h(5, 6, 1, 6) })).toEqual(["a"]);
    expect(deadSources({ a: h(0, 6, 0, 0), b: h(0, 6, 0, 0), c: h(5, 6, 1, 6) })).toEqual([]);
  });

  it("summarises a sampling round per source", () => {
    const s = summarizeProbes(
      [
        { source: "a", kind: "still", ok: true },
        { source: "a", kind: "still", ok: false },
        { source: "a", kind: "video", ok: true },
        { source: "b", kind: "video", ok: false },
      ],
      at,
    );
    expect(s).toEqual({ a: h(1, 2, 1, 1), b: h(0, 0, 0, 1) });
  });

  it("samples distinct items", () => {
    const items = Array.from({ length: 50 }, (_, i) => i);
    const s = sample(items, 6);
    expect(new Set(s).size).toBe(6);
    expect(sample([1, 2], 6).sort()).toEqual([1, 2]);
    expect(sample(items, 3, () => 0)).toEqual([0, 1, 2]);
  });
});

describe("playlists", () => {
  const master = "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1,RESOLUTION=1280x720\nchunklist_w1.m3u8\n";
  it("recognises playlists and resolves the first variant", () => {
    expect(isPlaylist(master)).toBe(true);
    expect(isPlaylist("#EXTM3U\n#EXTINF:10,\nseg1.ts\n")).toBe(true);
    expect(isPlaylist("<html>Not found</html>")).toBe(false);
    expect(isPlaylist("#EXTM3U\n")).toBe(false);
    expect(firstVariant(master, "https://v.example/live/cam.stream/playlist.m3u8")).toBe("https://v.example/live/cam.stream/chunklist_w1.m3u8");
    expect(firstVariant("#EXTM3U\n#EXTINF:10,\nseg1.ts\n", "https://v.example/x.m3u8")).toBeNull();
  });

  it("flags FairPlay / SAMPLE-AES streams as DRM but not AES-128", () => {
    expect(hasDrm('#EXTM3U\n#EXT-X-KEY:METHOD=SAMPLE-AES,URI="skd://fps.ezdrm.com/;abc",KEYFORMAT="com.apple.streamingkeydelivery"\n#EXTINF:10,\na.ts')).toBe(true);
    expect(hasDrm('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="https://k.example/key"\n#EXTINF:10,\na.ts')).toBe(false);
    expect(hasDrm("#EXTM3U\n#EXTINF:10,\na.ts")).toBe(false);
  });
});

describe("viewer fallback plan", () => {
  it("goes live HLS → MP4 → still", () => {
    expect(mediaPlan({ image: "i", video: "v", videoKind: "hls" })).toEqual(["hls", "still"]);
    expect(mediaPlan({ image: "i", video: "v", videoKind: "mp4" })).toEqual(["mp4", "still"]);
    expect(mediaPlan({ image: "i", video: null, videoKind: null })).toEqual(["still"]);
    expect(mediaPlan({ image: null, video: "v", videoKind: "hls" })).toEqual(["hls"]);
    expect(mediaPlan({ image: null, video: null, videoKind: null })).toEqual([]);
  });

  it("puts the still first when the source's streams are unhealthy", () => {
    expect(mediaPlan({ image: "i", video: "v", videoKind: "hls" }, false)).toEqual(["still", "hls"]);
    expect(mediaPlan({ image: null, video: "v", videoKind: "hls" }, false)).toEqual(["hls"]);
  });
});

describe("compact camera list", () => {
  const rows: CameraRow[] = [
    ["va:1", "I-95", -77, 38, idx("va"), "https://va/1.jpg", "https://va/1.m3u8", "hls"],
    ["al:1", "I-65", -86, 33, idx("al"), "https://al/1.jpg", "https://al/1.m3u8", "hls"],
    ["ia:1", "I-80", -93, 41, idx("ia"), "https://ia/1.jpg", null, null],
    ["md:1", "I-695", -76, 39, idx("md"), "", "https://md/1.m3u8", "hls"],
  ];
  const full: CamerasFull = { sources: CAMERA_SOURCES, rows, failed: [] };

  it("drops media URLs and dead sources, flags live only where streams are healthy", () => {
    const out = presentCameras(full, { al: h(6, 6, 0, 6), ia: h(0, 6, 0, 0), va: h(6, 6, 6, 6) });
    expect(out.hidden).toEqual(["ia"]);
    expect(out.rows).toEqual([
      ["va:1", "I-95", -77, 38, idx("va"), CAM_STILL | CAM_HLS | CAM_LIVE],
      ["al:1", "I-65", -86, 33, idx("al"), CAM_STILL | CAM_HLS],
      ["md:1", "I-695", -76, 39, idx("md"), CAM_HLS | CAM_LIVE],
    ]);
    expect(out.liveCount).toBe(2);
    expect(JSON.stringify(out)).not.toContain("https://va/1");
  });

  it("finds a camera's full row by id", () => {
    expect(findCamera(full, "al:1")?.[6]).toBe("https://al/1.m3u8");
    expect(findCamera(full, "nope")).toBeNull();
  });
});

describe("liveness sampler", () => {
  it("picks a few stills and streams per source", () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({ source: i < 10 ? "a" : "b", image: `https://x/${i}.jpg`, video: i % 2 ? `https://x/${i}.m3u8` : null, kind: i % 2 ? "hls" : null }));
    const t = probeTargets(rows, 3);
    expect(t.filter((x) => x.source === "a" && x.kind === "still")).toHaveLength(3);
    expect(t.filter((x) => x.source === "a" && x.kind === "video")).toHaveLength(3);
    expect(t.every((x) => (x.kind === "video" ? x.url.endsWith(".m3u8") : x.url.endsWith(".jpg")))).toBe(true);
  });

  it("limits concurrency overall and to one request per source", async () => {
    const targets = ["a", "a", "a", "b", "b", "c", "d", "e"].map((source, i) => ({ source, kind: "still" as const, url: `u${i}` }));
    let active = 0;
    let peak = 0;
    const perSource = new Map<string, number>();
    let perSourcePeak = 0;
    const res = await runProbes(
      targets,
      async (t) => {
        active++;
        peak = Math.max(peak, active);
        perSource.set(t.source, (perSource.get(t.source) ?? 0) + 1);
        perSourcePeak = Math.max(perSourcePeak, perSource.get(t.source)!);
        await new Promise((r) => setTimeout(r, 5));
        perSource.set(t.source, perSource.get(t.source)! - 1);
        active--;
        return t.source !== "c";
      },
      3,
    );
    expect(res).toHaveLength(8);
    expect(peak).toBeLessThanOrEqual(3);
    expect(perSourcePeak).toBe(1);
    expect(res.filter((r) => !r.ok).map((r) => r.source)).toEqual(["c"]);
    expect(await runProbes([], async () => true)).toEqual([]);
  });
});
