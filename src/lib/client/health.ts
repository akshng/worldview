/**
 * Source-health helpers for the Sources page and the top-bar dot. Defensive: the
 * health extras (records24h, anomaly, …) and /api/health are optional.
 */
import type { HealthResponse, SourceHealth } from "./api";

export type HealthLevel = "ok" | "warn" | "bad" | "unknown";

export interface HealthSummary {
  level: HealthLevel;
  total: number;
  online: number;
  degraded: number;
  error: number;
  anomalies: Array<{ id: string; name: string; anomaly: string; anomalyNote: string | null }>;
  /** One-line tooltip */
  text: string;
}

/** Problem rank: lower = worse (sorts problems first). */
export function problemRank(s: Pick<SourceHealth, "status" | "anomaly" | "consecutiveFailures">): number {
  if (s.status === "ERROR" || s.anomaly === "failing") return 0;
  if (s.anomaly) return 1;
  if (s.status === "DEGRADED") return 2;
  if (s.status === "PENDING" || s.status === "RUNNING") return 3;
  if (s.status === "DISABLED") return 5;
  return 4;
}

export const isProblem = (s: Pick<SourceHealth, "status" | "anomaly" | "consecutiveFailures">) => problemRank(s) <= 2;

export function sortSources<T extends Pick<SourceHealth, "status" | "anomaly" | "consecutiveFailures" | "name">>(list: T[], problemsFirst: boolean): T[] {
  return [...list].sort((a, b) => (problemsFirst ? problemRank(a) - problemRank(b) : 0) || a.name.localeCompare(b.name));
}

export const ANOMALY_LABEL: Record<string, string> = { "empty-streak": "Empty streak", "volume-drop": "Volume drop", failing: "Failing" };

function level(total: number, error: number, degraded: number, anomalies: number, failing: number): HealthLevel {
  if (!total) return "unknown";
  // Red when a real share of sources is down; amber for any problem.
  if (error + failing >= Math.max(3, Math.ceil(total * 0.2))) return "bad";
  if (error || degraded || anomalies) return "warn";
  return "ok";
}

function describe(h: Omit<HealthSummary, "text" | "level">, extra: string[] = []) {
  const parts = [`${h.online}/${h.total} sources online`];
  if (h.degraded) parts.push(`${h.degraded} degraded`);
  if (h.error) parts.push(`${h.error} failing`);
  if (h.anomalies.length) parts.push(`${h.anomalies.length} anomal${h.anomalies.length === 1 ? "y" : "ies"} (${h.anomalies.slice(0, 3).map((a) => a.name).join(", ")}${h.anomalies.length > 3 ? "…" : ""})`);
  return [...parts, ...extra].join(" · ");
}

export function summarizeHealth(health: HealthResponse | null, sources: SourceHealth[] | null): HealthSummary {
  if (health?.sources) {
    const s = health.sources;
    const anomalies = (s.anomalies ?? []).map((a) => ({ id: a.id, name: a.name, anomaly: String(a.anomaly), anomalyNote: a.anomalyNote ?? null }));
    const base = { total: s.total ?? 0, online: s.online ?? 0, degraded: s.degraded ?? 0, error: s.error ?? 0, anomalies };
    const extra = health.lastBriefingLateMinutes && health.lastBriefingLateMinutes > 0 ? [`morning briefing ${Math.round(health.lastBriefingLateMinutes)} min late`] : [];
    let lv = level(base.total, base.error, base.degraded, anomalies.length, anomalies.filter((a) => a.anomaly === "failing").length);
    if (health.ok === false && lv === "ok") lv = "warn";
    if (extra.length && lv === "ok") lv = "warn";
    return { ...base, level: lv, text: describe(base, extra) };
  }
  const list = (sources ?? []).filter((x) => x.status !== "DISABLED");
  const anomalies = list.filter((x) => x.anomaly).map((x) => ({ id: x.id, name: x.name, anomaly: String(x.anomaly), anomalyNote: x.anomalyNote ?? null }));
  const base = {
    total: list.length,
    online: list.filter((x) => x.status === "ONLINE" || x.status === "RUNNING").length,
    degraded: list.filter((x) => x.status === "DEGRADED").length,
    error: list.filter((x) => x.status === "ERROR").length,
    anomalies,
  };
  const lv = sources ? level(base.total, base.error, base.degraded, anomalies.length, anomalies.filter((a) => a.anomaly === "failing" && list.find((x) => x.id === a.id)?.status !== "ERROR").length) : "unknown";
  return { ...base, level: lv, text: sources ? describe(base) : "Health unknown" };
}
