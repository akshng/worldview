import { readFile } from "node:fs/promises";
import path from "node:path";
import { env } from "@/lib/env";
import { buildDigest, setupsSince, type Digest, type DigestSetup } from "@/lib/client/digest";
import { getRepository } from "@/lib/server/context";
import { badRequest, handler, json } from "@/lib/server/http";

export const dynamic = "force-dynamic";

const MAX_LOOKBACK_MS = 8 * 86_400_000;

/** Setups the after-close scan posted (DATA_DIR/setups/picks.json) — a file read, no market calls. */
async function postedSetups(): Promise<DigestSetup[]> {
  try {
    const log = JSON.parse(await readFile(path.resolve(process.cwd(), env().DATA_DIR, "setups", "picks.json"), "utf8")) as unknown;
    if (!Array.isArray(log)) return [];
    return log.flatMap((p) =>
      p && typeof p.date === "string" && typeof p.symbol === "string"
        ? [{ date: p.date, symbol: p.symbol, name: String(p.name ?? p.symbol), score: Number(p.score) || 0, signals: Array.isArray(p.signals) ? p.signals.map(String).slice(0, 4) : [] }]
        : [],
    );
  } catch {
    return [];
  }
}

/** GET /api/digest?since=ISO — new high-importance events and posted setups since the last visit. */
export const GET = handler(async (req: Request) => {
  const raw = new URL(req.url).searchParams.get("since");
  const parsed = raw ? Date.parse(raw) : NaN;
  if (!Number.isFinite(parsed)) return badRequest("since must be an ISO date");
  const now = Date.now();
  const since = Math.max(parsed, now - MAX_LOOKBACK_MS);
  const repo = await getRepository();
  // Events first seen after `since` can carry an earlier event time (late reports): look back 12 h more.
  const events = await repo.scan({ from: new Date(since - 12 * 3_600_000).toISOString() });
  const digest: Digest = { ...buildDigest(events, since, now), setups: setupsSince(await postedSetups(), since).slice(0, 5) };
  return json(digest);
});
