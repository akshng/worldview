import { describe, expect, it } from "vitest";
import { buildDigest, notableMoves, setupsSince, shouldShowDigest } from "@/lib/client/digest";
import { csvCell, eventsToCsv, eventsToGeoJSON, exportName, seriesToCsv } from "@/lib/client/export";
import { isProblem, problemRank, sortSources, summarizeHealth } from "@/lib/client/health";
import { advanceCursor } from "@/components/timeline/use-replay";
import type { SourceHealth } from "@/lib/client/api";

const NOW = Date.parse("2026-11-12T12:00:00Z");
const H = 3_600_000;

const e = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  type: "EARTHQUAKE",
  title: `Event ${id}`,
  importanceScore: 70,
  status: "REPORTED",
  isSynthetic: false,
  countryName: "Japan",
  locationName: null,
  latitude: 35.123456789,
  longitude: 139.5,
  timestamp: new Date(NOW - H).toISOString(),
  createdAt: new Date(NOW - H).toISOString(),
  ...over,
});

describe("since you last looked", () => {
  it("counts new high-importance events by category and picks the top 5", () => {
    const events = [
      ...Array.from({ length: 6 }, (_, i) => e(`q${i}`, { importanceScore: 62 + i })),
      e("conflict", { type: "CONFLICT", importanceScore: 90 }),
      e("low", { importanceScore: 40 }),
      e("before", { createdAt: new Date(NOW - 5 * H).toISOString() }),
      e("resolved", { status: "RESOLVED" }),
      e("demo", { isSynthetic: true }),
    ];
    const d = buildDigest(events, NOW - 3 * H, NOW);
    expect(d.highCount).toBe(7);
    expect(d.byCategory).toEqual([{ type: "EARTHQUAKE", count: 6 }, { type: "CONFLICT", count: 1 }]);
    expect(d.top.map((x) => x.id)).toEqual(["conflict", "q5", "q4", "q3", "q2"]);
    expect(d.top[0].where).toBe("Japan");
  });
  it("shows only after a real absence", () => {
    expect(shouldShowDigest(null, NOW)).toBe(false);
    expect(shouldShowDigest(NOW - H, NOW)).toBe(false);
    expect(shouldShowDigest(NOW - 2 * H, NOW)).toBe(true);
  });
  it("filters setups by New York date and notable moves by size", () => {
    expect(setupsSince([{ date: "2026-11-10" }, { date: "2026-11-12" }, { date: "2026-11-11" }], Date.parse("2026-11-11T15:00:00Z")).map((p) => p.date)).toEqual(["2026-11-12", "2026-11-11"]);
    expect(notableMoves([{ symbol: "A", changePct: 1 }, { symbol: "B", changePct: -3.2 }, { symbol: "C", changePct: 2.5 }, { symbol: "D", changePct: null }]).map((q) => q.symbol)).toEqual(["B", "C"]);
  });
});

describe("export", () => {
  const ev = { id: "x,1", timestamp: "2026-11-12T10:00:00.000Z", title: 'He said "hi"', type: "NEWS", importanceScore: 55.6, status: "REPORTED", country: null, latitude: 1.234567891, longitude: -2, primarySource: "=HYPERLINK(evil)", sourceUrl: "javascript:alert(1)" };
  it("writes RFC 4180 CSV and defuses formulas", () => {
    expect(csvCell('a"b')).toBe('"a""b"');
    expect(csvCell("=1+1")).toBe("'=1+1");
    expect(csvCell(-5)).toBe("-5");
    const csv = eventsToCsv([ev]);
    const [head, row] = csv.trim().split("\r\n");
    expect(head).toBe("id,time,title,type,importance,status,country,lat,lon,primary_source,url");
    expect(row).toBe('"x,1",2026-11-12T10:00:00.000Z,"He said ""hi""",NEWS,56,REPORTED,,1.23457,-2,\'=HYPERLINK(evil),');
  });
  it("writes GeoJSON points (lon, lat) with only http(s) links", () => {
    const g = eventsToGeoJSON([{ ...ev, sourceUrl: "https://example.org/a" }]);
    expect(g.features[0].geometry.coordinates).toEqual([-2, 1.23457]);
    expect(g.features[0].properties.url).toBe("https://example.org/a");
    expect(eventsToGeoJSON([ev]).features[0].properties.url).toBeNull();
  });
  it("exports a chart series and names files safely", () => {
    expect(seriesToCsv([[Date.parse("2026-11-01T00:00:00Z"), 3]], { xIsTime: true, name: "events" })).toBe("time,events\r\n2026-11-01T00:00:00.000Z,3\r\n");
    expect(exportName("S&P 500 / 6mo", "csv", new Date("2026-11-12T09:30:00Z"))).toBe("worldview-s-p-500-6mo-2026-11-12T0930.csv");
  });
});

describe("replay", () => {
  it("advances hours per second and ends at live", () => {
    expect(advanceCursor(NOW - 10 * H, 4, 500, NOW)).toBe(NOW - 8 * H);
    expect(advanceCursor(NOW - H, 16, 1000, NOW)).toBeNull();
  });
});

describe("source health", () => {
  const src = (id: string, status: SourceHealth["status"], over: Partial<SourceHealth> = {}) =>
    ({ id, name: id.toUpperCase(), status, consecutiveFailures: 0, ...over }) as SourceHealth;
  it("ranks problems first, works without the optional fields", () => {
    const list = [src("b", "ONLINE"), src("a", "ONLINE", { anomaly: "volume-drop" }), src("c", "ERROR"), src("d", "DEGRADED"), src("e", "DISABLED")];
    expect(sortSources(list, true).map((s) => s.id)).toEqual(["c", "a", "d", "b", "e"]);
    expect(sortSources(list, false).map((s) => s.id)).toEqual(["a", "b", "c", "d", "e"]);
    expect(list.filter(isProblem).map((s) => s.id)).toEqual(["a", "c", "d"]);
    expect(problemRank(src("x", "ONLINE", { anomaly: "failing" }))).toBe(0);
  });
  it("derives a level from /api/health or falls back to /api/sources", () => {
    expect(summarizeHealth({ ok: true, sources: { total: 80, online: 80, degraded: 0, error: 0, anomalies: [] } }, null).level).toBe("ok");
    const warn = summarizeHealth({ ok: true, sources: { total: 80, online: 78, degraded: 1, error: 1, anomalies: [{ id: "x", name: "X", anomaly: "empty-streak", anomalyNote: "6 empty runs" }] } }, null);
    expect(warn.level).toBe("warn");
    expect(warn.text).toContain("1 anomaly (X)");
    expect(summarizeHealth({ ok: false, sources: { total: 20, online: 10, degraded: 0, error: 10, anomalies: [] } }, null).level).toBe("bad");
    expect(summarizeHealth(null, [src("a", "ONLINE"), src("b", "ONLINE"), src("z", "DISABLED")]).level).toBe("ok");
    expect(summarizeHealth(null, [src("a", "ONLINE"), src("b", "DEGRADED")]).level).toBe("warn");
    expect(summarizeHealth(null, null).level).toBe("unknown");
  });
});
