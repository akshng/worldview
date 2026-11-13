import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, statSync, writeFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { IngestionRun } from "@/lib/db/types";
import { LruMap, globalLru } from "@/lib/server/lru";
import { parseRetryAfter } from "@/lib/server/retry-after";
import { SecRateLimitedError, _resetSecGate, isSecUrl, pauseSec, reserveSlot, secGateFetch, SEC_MIN_GAP_MS } from "@/lib/finance/sec-http";
import { SourceHttpError, httpGet } from "@/data-sources/types";
import { DAY, HOUR, analyzeSource, emptyStats, failureExplainedBySleep, isLate, median, nextRunDelay, recordStats, wallCapMs, type SourceStats } from "@/lib/server/source-health";
import { rotateLog, timestampArgs } from "@/lib/server/logs";
import { filesToPrune, pruneCaches } from "@/lib/server/disk-prune";
import { allFailed } from "@/layers/cameras/health";
import { briefingLateMinutes, healthOk, scheduledTime, summarizeSources } from "@/lib/server/health-summary";
import { decodeParam } from "@/lib/server/http";

describe("LruMap", () => {
  it("evicts the least recently used entry beyond its size", () => {
    const m = new LruMap<string, number>(2);
    m.set("a", 1).set("b", 2);
    expect(m.get("a")).toBe(1); // a is now most recent
    m.set("c", 3);
    expect([...m.keys()]).toEqual(["a", "c"]);
    expect(m.has("b")).toBe(false);
    m.set("a", 9); // overwrite refreshes
    m.set("d", 4);
    expect([...m.keys()]).toEqual(["a", "d"]);
    expect(m.peek("a")).toBe(9);
    expect(m.size).toBe(2);
  });
  it("rejects a size below 1", () => {
    expect(() => new LruMap(0)).toThrow();
  });
  it("globalLru shares one instance and adopts a legacy Map", () => {
    (globalThis as Record<string, unknown>).__testLru = new Map([["x", 1]]);
    const a = globalLru<string, number>("__testLru", 10);
    expect(a.get("x")).toBe(1);
    expect(globalLru("__testLru", 10)).toBe(a);
    delete (globalThis as Record<string, unknown>).__testLru;
  });
});

describe("parseRetryAfter", () => {
  const now = Date.parse("2026-11-12T12:00:00Z");
  it("reads delay-seconds and HTTP dates", () => {
    expect(parseRetryAfter("120", now)).toBe(120_000);
    expect(parseRetryAfter("Thu, 12 Nov 2026 12:01:30 GMT", now)).toBe(90_000);
    expect(parseRetryAfter("Thu, 12 Nov 2026 11:00:00 GMT", now)).toBe(0); // in the past
  });
  it("returns null for missing or junk values and clamps huge ones", () => {
    expect(parseRetryAfter(null, now)).toBeNull();
    expect(parseRetryAfter("soon", now)).toBeNull();
    expect(parseRetryAfter("999999999", now, 3_600_000)).toBe(3_600_000);
  });
});

describe("SEC fair-access gate", () => {
  beforeEach(() => _resetSecGate());
  const UA = { "User-Agent": "WorldView/0.1 (test)" };

  it("recognises every *.sec.gov host and nothing else", () => {
    expect(isSecUrl("https://data.sec.gov/submissions/CIK0000320193.json")).toBe(true);
    expect(isSecUrl("https://www.sec.gov/cgi-bin/browse-edgar")).toBe(true);
    expect(isSecUrl("https://efts.sec.gov/LATEST/search-index")).toBe(true);
    expect(isSecUrl("https://notsec.gov.example.com/")).toBe(false);
    expect(isSecUrl("https://evilsec.gov/")).toBe(false);
    expect(isSecUrl("not a url")).toBe(false);
  });

  it("spaces requests 125 ms apart (≤ 8/s)", () => {
    const now = 1_000_000;
    expect(reserveSlot(now)).toBe(0);
    expect(reserveSlot(now)).toBe(SEC_MIN_GAP_MS);
    expect(reserveSlot(now)).toBe(2 * SEC_MIN_GAP_MS);
    expect(1000 / SEC_MIN_GAP_MS).toBeLessThanOrEqual(8);
  });

  it("fails fast while SEC traffic is paused for long", () => {
    const now = 1_000_000;
    pauseSec(10 * 60_000, now);
    expect(() => reserveSlot(now)).toThrow(SecRateLimitedError);
  });

  it("retries a 429 after its Retry-After and returns the success", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("slow down", { status: 429, headers: { "Retry-After": "0" } }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));
    const res = await secGateFetch("https://data.sec.gov/x.json", { headers: UA, fetchImpl });
    expect(res.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect((fetchImpl.mock.calls[0][1]!.headers as Record<string, string>)["User-Agent"]).toBe(UA["User-Agent"]);
  });

  it("gives back a 429 whose Retry-After is too long to wait, and pauses later requests", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response("", { status: 429, headers: { "Retry-After": "600" } }));
    const res = await secGateFetch("https://www.sec.gov/x", { headers: UA, fetchImpl });
    expect(res.status).toBe(429);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await expect(secGateFetch("https://www.sec.gov/y", { headers: UA, fetchImpl })).rejects.toBeInstanceOf(SecRateLimitedError);
  });

  it("treats SEC's 403 'Request Rate Threshold Exceeded' as a 10-minute pause", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response("Your Request Rate Threshold Exceeded", { status: 403 }));
    expect((await secGateFetch("https://www.sec.gov/x", { headers: UA, fetchImpl })).status).toBe(403);
    expect(() => reserveSlot()).toThrow(SecRateLimitedError);
  });

  it("requires the app's User-Agent", async () => {
    await expect(secGateFetch("https://www.sec.gov/x", { headers: {}, fetchImpl: vi.fn<typeof fetch>() })).rejects.toThrow(/User-Agent/);
  });
});

describe("httpGet Retry-After", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("surfaces Retry-After on a 429 as retryAfterMs", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 429, headers: { "Retry-After": "90" } })));
    const err = await httpGet("https://api.example.org/x", { signal: new AbortController().signal, userAgent: "WorldView/0.1 (test)" }).catch((e) => e);
    expect(err).toBeInstanceOf(SourceHttpError);
    expect(err.status).toBe(429);
    expect(err.retryAfterMs).toBe(90_000);
    expect(err.message).toMatch(/rate limited — retry after 90 s/);
  });
  it("has no retryAfterMs for other errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 500, statusText: "Server Error" })));
    const err = await httpGet("https://api.example.org/x", { signal: new AbortController().signal, userAgent: "UA" }).catch((e) => e);
    expect(err.retryAfterMs).toBeNull();
  });
});

describe("scheduler timing", () => {
  it("detects timers that fire long after they were due (sleep)", () => {
    expect(isLate(0, 5_000)).toBe(false);
    expect(isLate(0, 10 * 60_000)).toBe(true);
  });
  it("explains a failure by sleep when a wake followed its start or its wall time is far past its timeout", () => {
    expect(failureExplainedBySleep(1_000, 50_000, 45_000, null)).toBe(false);
    expect(failureExplainedBySleep(1_000, 50_000, 45_000, 2_000)).toBe(true);
    expect(failureExplainedBySleep(1_000, 50_000, 45_000, 500)).toBe(false); // wake before the run
    expect(failureExplainedBySleep(0, 3_600_000, 45_000, null)).toBe(true);
    expect(failureExplainedBySleep(0, wallCapMs(45_000), 45_000, null)).toBe(false); // capped while awake: a real failure
  });
  it("backs off exponentially and honours Retry-After", () => {
    expect(nextRunDelay(60_000, 0)).toBe(60_000);
    expect(nextRunDelay(60_000, 2)).toBe(240_000);
    expect(nextRunDelay(60_000, 10)).toBe(480_000);
    expect(nextRunDelay(60_000, 1, 30 * 60_000)).toBe(30 * 60_000);
    expect(nextRunDelay(60_000, 1, 48 * HOUR)).toBe(6 * HOUR);
  });
});

const NOW = Date.parse("2026-11-12T12:00:00Z");
let seq = 0;
function run(p: Partial<IngestionRun> & { ago: number }): IngestionRun {
  const started = NOW - p.ago;
  return {
    id: `r${seq++}`,
    dataSourceId: "src",
    startedAt: new Date(started).toISOString(),
    completedAt: new Date(started + 1000).toISOString(),
    success: true,
    recordsReceived: 10,
    recordsCreated: 1,
    recordsUpdated: 1,
    recordsDeduplicated: 0,
    recordsSkipped: 0,
    recordsInvalid: 0,
    errors: [],
    durationMs: 1000,
    ...p,
  };
}

/** Stats with `perHour` records every hour for `days` days ending `endAgo` before NOW. */
function steadyStats(days: number, perHour: number, endAgo = 0, received = 5): SourceStats {
  const s = emptyStats(NOW - days * DAY - endAgo);
  for (let t = NOW - days * DAY - endAgo; t < NOW - endAgo; t += HOUR) recordStats(s, { recordsReceived: received, recordsCreated: perHour, recordsUpdated: 0 }, t);
  return s;
}

describe("source anomalies", () => {
  it("flags ≥3 consecutive failures as failing", () => {
    const runs = [run({ ago: 1, success: false, errors: ["HTTP 500"] }), run({ ago: 2, success: false }), run({ ago: 3, success: false }), run({ ago: 4 })];
    const r = analyzeSource({ runs, stats: null, consecutiveFailures: 0, refreshIntervalMs: HOUR, now: NOW });
    expect(r.anomaly).toBe("failing");
    expect(r.anomalyNote).toMatch(/3 consecutive.*HTTP 500/);
  });

  it("flags an empty streak only for a source that normally returns data", () => {
    const empties = [1, 2, 3].map((i) => run({ ago: i * 60_000, recordsReceived: 0, recordsCreated: 0, recordsUpdated: 0 }));
    const usual = [4, 5, 6, 7].map((i) => run({ ago: i * 60_000 }));
    const r = analyzeSource({ runs: [...empties, ...usual], stats: null, consecutiveFailures: 0, refreshIntervalMs: 60_000, now: NOW });
    expect(r.anomaly).toBe("empty-streak");
    expect(r.lastNonEmptyAt).toBe(usual[0].completedAt);
    // A source that is usually empty (e.g. emergency squawks) is not flagged.
    const rare = [4, 5, 6, 7].map((i) => run({ ago: i * 60_000, recordsReceived: i === 4 ? 2 : 0 }));
    expect(analyzeSource({ runs: [...empties, ...rare], stats: null, consecutiveFailures: 0, refreshIntervalMs: 60_000, now: NOW }).anomaly).toBeNull();
  });

  it("uses volume stats from before the streak to judge 'normally returns data'", () => {
    const empties = [1, 2, 3].map((i) => run({ ago: i * 60_000, recordsReceived: 0, recordsCreated: 0, recordsUpdated: 0 }));
    expect(analyzeSource({ runs: empties, stats: steadyStats(3, 4, HOUR), consecutiveFailures: 0, refreshIntervalMs: HOUR, now: NOW }).anomaly).toBe("empty-streak");
    expect(analyzeSource({ runs: empties, stats: steadyStats(3, 0, HOUR, 0), consecutiveFailures: 0, refreshIntervalMs: HOUR, now: NOW }).anomaly).toBeNull();
  });

  it("flags a volume drop below 20 % of the 7-day daily median", () => {
    const s = steadyStats(8, 10, DAY); // 240/day for the 7 days before the last 24 h
    for (let t = NOW - DAY; t < NOW; t += HOUR) recordStats(s, { recordsReceived: 5, recordsCreated: 1, recordsUpdated: 0 }, t); // 24 today
    const r = analyzeSource({ runs: [run({ ago: 60_000 })], stats: s, consecutiveFailures: 0, refreshIntervalMs: HOUR, now: NOW });
    expect(r.records24h).toBe(24);
    expect(r.anomaly).toBe("volume-drop");
    expect(r.anomalyNote).toMatch(/24 records.*median of 240/);
  });

  it("doesn't call a volume drop when the server barely ran today, or without enough history", () => {
    const s = steadyStats(8, 10, DAY);
    recordStats(s, { recordsReceived: 5, recordsCreated: 1, recordsUpdated: 0 }, NOW - HOUR); // 1 run today
    expect(analyzeSource({ runs: [], stats: s, consecutiveFailures: 0, refreshIntervalMs: HOUR, now: NOW }).anomaly).toBeNull();
    const young = steadyStats(1.5, 10, 0);
    expect(analyzeSource({ runs: [], stats: young, consecutiveFailures: 0, refreshIntervalMs: HOUR, now: NOW }).anomaly).toBeNull();
  });

  it("counts records24h from run history before stats exist", () => {
    const r = analyzeSource({ runs: [run({ ago: HOUR, recordsCreated: 3, recordsUpdated: 2 }), run({ ago: 2 * DAY, recordsCreated: 50 })], stats: null, consecutiveFailures: 0, refreshIntervalMs: HOUR, now: NOW });
    expect(r.records24h).toBe(5);
    expect(r.anomaly).toBeNull();
  });

  it("median", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBe(0);
  });
});

describe("logs", () => {
  it("prefixes the first string argument with a timestamp", () => {
    const at = new Date("2026-11-12T12:00:00.000Z");
    expect(timestampArgs(["[x] %s", "y"], at)).toEqual(["2026-11-12T12:00:00.000Z [x] %s", "y"]);
    expect(timestampArgs([{ a: 1 }], at)).toEqual(["2026-11-12T12:00:00.000Z", { a: 1 }]);
  });
  it("rotates by copy-truncate above the size cap, keeping N copies", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "wv-logs-"));
    const f = path.join(dir, "server.log");
    writeFileSync(f, "small");
    expect(rotateLog(f, 100, 2)).toBe(false);
    writeFileSync(f, "a".repeat(200));
    expect(rotateLog(f, 100, 2)).toBe(true);
    expect(statSync(f).size).toBe(0);
    expect(readFileSync(`${f}.1`, "utf8")).toHaveLength(200);
    writeFileSync(f, "b".repeat(200));
    rotateLog(f, 100, 2);
    writeFileSync(f, "c".repeat(200));
    rotateLog(f, 100, 2);
    expect(readFileSync(`${f}.1`, "utf8")[0]).toBe("c");
    expect(readFileSync(`${f}.2`, "utf8")[0]).toBe("b");
    expect(existsSync(`${f}.3`)).toBe(false);
    expect(rotateLog(path.join(dir, "missing.log"), 1)).toBe(false);
  });
});

describe("disk cache pruning", () => {
  const now = Date.parse("2026-11-12T00:00:00Z");
  it("drops files past their age, then the oldest beyond the count", () => {
    const files = [
      { name: "a.json", mtimeMs: now - 1 * DAY },
      { name: "b.json", mtimeMs: now - 2 * DAY },
      { name: "c.json", mtimeMs: now - 3 * DAY },
      { name: "old.json", mtimeMs: now - 400 * DAY },
      { name: "keep.txt", mtimeMs: now - 999 * DAY },
    ];
    expect(filesToPrune(files, { match: /\.json$/, maxAgeMs: 365 * DAY, maxFiles: 2 }, now).sort()).toEqual(["c.json", "old.json"]);
  });
  it("prunes real directories and leaves unmatched files alone", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "wv-prune-"));
    const { mkdirSync, utimesSync } = await import("node:fs");
    mkdirSync(path.join(dir, "insiders"));
    writeFileSync(path.join(dir, "insiders", "0001-26-1.json"), "[]");
    writeFileSync(path.join(dir, "insiders", "notes.md"), "x");
    const old = new Date(Date.now() - 400 * DAY);
    utimesSync(path.join(dir, "insiders", "0001-26-1.json"), old, old);
    expect(await pruneCaches(dir)).toBe(1);
    expect(existsSync(path.join(dir, "insiders", "notes.md"))).toBe(true);
  });
});

describe("camera liveness offline round", () => {
  it("treats a round where every probe failed as offline", () => {
    expect(allFailed([{ source: "a", kind: "still", ok: false }, { source: "b", kind: "video", ok: false }])).toBe(true);
    expect(allFailed([{ source: "a", kind: "still", ok: false }, { source: "b", kind: "still", ok: true }])).toBe(false);
    expect(allFailed([])).toBe(false);
  });
});

describe("health summary", () => {
  const src = (id: string, status: string, anomaly: null | "empty-streak" | "volume-drop" | "failing" = null) => ({ id, name: id.toUpperCase(), status, anomaly, anomalyNote: anomaly ? "note" : null });
  it("counts statuses and lists anomalies", () => {
    const s = summarizeSources([src("a", "ONLINE"), src("b", "DEGRADED", "empty-streak"), src("c", "ERROR", "failing"), src("d", "DISABLED")]);
    expect(s).toMatchObject({ total: 4, online: 1, degraded: 1, error: 1 });
    expect(s.anomalies).toEqual([
      { id: "b", name: "B", anomaly: "empty-streak", anomalyNote: "note" },
      { id: "c", name: "C", anomaly: "failing", anomalyNote: "note" },
    ]);
  });
  it("is ok unless more than a quarter of enabled sources fail", () => {
    expect(healthOk([src("a", "ONLINE"), src("b", "ONLINE"), src("c", "ONLINE"), src("d", "ERROR")])).toBe(true);
    expect(healthOk([src("a", "ONLINE"), src("b", "ERROR"), src("c", "ERROR")])).toBe(false);
  });
  it("reads the briefing schedule and measures lateness", () => {
    expect(scheduledTime("<key>Hour</key><integer>6</integer>\n<key>Minute</key><integer>45</integer>")).toEqual({ hour: 6, minute: 45 });
    expect(scheduledTime(null)).toEqual({ hour: 7, minute: 30 });
    const due = new Date(2026, 10, 12, 7, 30).getTime();
    expect(briefingLateMinutes("2026-11-12", new Date(due + 95 * 60_000).toISOString(), { hour: 7, minute: 30 })).toBe(95);
    expect(briefingLateMinutes("2026-11-12", new Date(due - 60_000).toISOString(), { hour: 7, minute: 30 })).toBe(0);
    expect(briefingLateMinutes("bad", "x", { hour: 7, minute: 30 })).toBeNull();
  });
});

describe("decodeParam", () => {
  it("decodes valid params and returns null for malformed percent-encoding", () => {
    expect(decodeParam("BRK.B")).toBe("BRK.B");
    expect(decodeParam("%5EGSPC")).toBe("^GSPC");
    expect(decodeParam("%E0%A4%A")).toBeNull();
    expect(decodeParam("%")).toBeNull();
  });
});
