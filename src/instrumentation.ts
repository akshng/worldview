/**
 * Runs once when the server starts:
 *  - timestamps every console line (server.log lines can be placed in time);
 *  - rotates the server and job logs above 5 MB (keeping 2), now and hourly;
 *  - prunes old on-disk caches (Form 4, 13F, 10-K analyses; never the briefing archive).
 * The camera layer is NOT warmed here: its ~30 operator feeds and the liveness sampler
 * start lazily on the first camera request (getLayer → startLayerBackground), so a
 * server that nobody opens the camera view on never polls them.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const dataDir = process.env.DATA_DIR || ".data";
  const { installConsoleTimestamps, rotateKnownLogs } = await import("@/lib/server/logs");
  installConsoleTimestamps();
  const rotated = rotateKnownLogs(dataDir);
  if (rotated.length) console.info(`[worldview] rotated logs: ${rotated.join(", ")}`);
  setInterval(() => rotateKnownLogs(dataDir), 3_600_000).unref?.();
  const { pruneCaches } = await import("@/lib/server/disk-prune");
  void pruneCaches(dataDir)
    .then((n) => n && console.info(`[worldview] pruned ${n} old cache files`))
    .catch((e) => console.warn("[worldview] cache prune failed:", e));
}
