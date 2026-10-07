/**
 * Latest settled image times for the NASA GIBS layers the globe uses.
 * Primary: one small WMTS DescribeDomains request per layer (fresh, ~400 bytes,
 * limited to the last few days). Fallback: the full capabilities document
 * (~6 MB, CDN-cached by GIBS for up to 30 min). Results are cached 5 minutes.
 */
import "server-only";
import { userAgent } from "@/lib/env";
import {
  GIBS_BASE,
  GIBS_KEYS,
  GIBS_LAYERS,
  candidateTimes,
  gibsTileUrl,
  parseCapabilitiesTimes,
  parseDescribeDomains,
  type GibsKey,
  type ImageryLatestResponse,
  type ImageryTimes,
} from "./index";

const TTL = 5 * 60_000;
const DAY = 86_400_000;

async function getText(url: string, timeoutMs: number): Promise<string> {
  const res = await fetch(url, { headers: { "User-Agent": userAgent() }, signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

export function describeDomainsUrl(key: GibsKey, now: Date): string {
  const l = GIBS_LAYERS[key];
  const from = new Date(now.getTime() - 3 * DAY).toISOString().slice(0, 10);
  const to = new Date(now.getTime() + DAY).toISOString().slice(0, 10);
  // GIBS rejects a percent-encoded TIME range (":" and "/"), so build the query by hand.
  return (
    `${GIBS_BASE}/wmts.cgi?SERVICE=WMTS&REQUEST=DescribeDomains&VERSION=1.0.0` +
    `&LAYER=${l.id}&TILEMATRIXSET=${l.tileMatrixSet}&TIME=${from}T00:00:00Z/${to}T00:00:00Z`
  );
}

/**
 * A settled 10-minute frame. GIBS lists the newest frame while its tiles are
 * still being published one by one (other tiles 404 for several minutes), so
 * skip the newest step and use the newest earlier frame whose world tile is served.
 */
async function verifiedTime(key: GibsKey, latest: string): Promise<string | null> {
  const l = GIBS_LAYERS[key];
  if (l.cadence === "daily") return latest; // the client uses the previous complete day anyway
  for (const t of candidateTimes(latest, 4).slice(1)) {
    try {
      const res = await fetch(gibsTileUrl(l, t).replace("{z}/{y}/{x}", "0/0/0"), {
        headers: { "User-Agent": userAgent() },
        signal: AbortSignal.timeout(15_000),
        cache: "no-store",
      });
      await res.arrayBuffer().catch(() => null);
      if (res.ok) return t;
    } catch {
      // try the previous step
    }
  }
  return null;
}

async function load(): Promise<ImageryLatestResponse> {
  const now = new Date();
  const times: ImageryTimes = {};
  const failed: GibsKey[] = [];
  await Promise.all(
    GIBS_KEYS.map(async (key) => {
      try {
        const t = parseDescribeDomains(await getText(describeDomainsUrl(key, now), 15_000), GIBS_LAYERS[key].cadence);
        if (t) times[key] = t;
        else failed.push(key);
      } catch {
        failed.push(key);
      }
    }),
  );
  let via = "describe-domains";
  if (failed.length) {
    try {
      const caps = parseCapabilitiesTimes(await getText(`${GIBS_BASE}/1.0.0/WMTSCapabilities.xml`, 30_000), failed);
      for (const k of Object.keys(caps) as GibsKey[]) times[k] = caps[k];
      via = Object.keys(caps).length ? "describe-domains+capabilities" : via;
    } catch {
      // keep what we have
    }
  }
  await Promise.all(
    (Object.keys(times) as GibsKey[]).map(async (k) => {
      const t = await verifiedTime(k, times[k]!);
      if (t) times[k] = t;
      else delete times[k];
    }),
  );
  return { times, checkedAt: now.toISOString(), via, failed: GIBS_KEYS.filter((k) => !times[k]) };
}

const g = globalThis as unknown as { __worldviewImagery?: { at: number; value: ImageryLatestResponse }; __worldviewImageryP?: Promise<ImageryLatestResponse> };

export async function getLatestImagery(): Promise<ImageryLatestResponse> {
  const hit = g.__worldviewImagery;
  if (hit && Date.now() - hit.at < TTL) return hit.value;
  g.__worldviewImageryP ??= load().finally(() => {
    g.__worldviewImageryP = undefined;
  });
  const value = await g.__worldviewImageryP;
  // Never replace good times with an empty result; merge so a single failed layer keeps its last time.
  const merged: ImageryLatestResponse = hit ? { ...value, times: { ...hit.value.times, ...value.times } } : value;
  merged.failed = GIBS_KEYS.filter((k) => !merged.times[k]);
  if (Object.keys(merged.times).length) g.__worldviewImagery = { at: Date.now(), value: merged };
  return merged;
}
