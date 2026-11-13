/**
 * Pure helpers for GET /api/health (unit-tested): source counts + anomaly list, and how
 * late the last morning briefing was against its scheduled local time.
 */
import type { SourceAnomaly } from "./source-health";

export interface HealthSourceLike {
  id: string;
  name: string;
  status: string;
  anomaly: SourceAnomaly;
  anomalyNote: string | null;
}

export function summarizeSources(sources: HealthSourceLike[]) {
  return {
    total: sources.length,
    online: sources.filter((s) => s.status === "ONLINE").length,
    degraded: sources.filter((s) => s.status === "DEGRADED").length,
    error: sources.filter((s) => s.status === "ERROR").length,
    anomalies: sources.filter((s) => s.anomaly).map((s) => ({ id: s.id, name: s.name, anomaly: s.anomaly, anomalyNote: s.anomalyNote })),
  };
}

/**
 * Overall verdict: at most a quarter of the enabled sources are in ERROR or flagged
 * "failing" (a few flaky upstreams are normal with ~90 sources).
 */
export function healthOk(sources: HealthSourceLike[]): boolean {
  const enabled = sources.filter((s) => s.status !== "DISABLED");
  if (!enabled.length) return true;
  const bad = enabled.filter((s) => s.status === "ERROR" || s.anomaly === "failing").length;
  return bad <= enabled.length / 4;
}

/** Hour/minute of the morning-briefing LaunchAgent (StartCalendarInterval), default 07:30. */
export function scheduledTime(plistXml: string | null): { hour: number; minute: number } {
  const hour = Number(plistXml?.match(/<key>Hour<\/key>\s*<integer>(\d+)<\/integer>/)?.[1]);
  const minute = Number(plistXml?.match(/<key>Minute<\/key>\s*<integer>(\d+)<\/integer>/)?.[1]);
  return Number.isFinite(hour) && Number.isFinite(minute) ? { hour, minute } : { hour: 7, minute: 30 };
}

/**
 * Minutes between the briefing's scheduled local time on its date (YYYY-MM-DD, local) and
 * when it was generated; 0 when on time or early, null when unknown.
 */
export function briefingLateMinutes(date: string, generatedAt: string, at: { hour: number; minute: number }): number | null {
  const m = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const gen = Date.parse(generatedAt);
  if (!m || !Number.isFinite(gen)) return null;
  const due = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), at.hour, at.minute).getTime();
  return Math.max(0, Math.round((gen - due) / 60_000));
}
