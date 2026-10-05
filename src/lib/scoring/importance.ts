/**
 * Deterministic, rule-based importance score (0–100).
 *
 *   score = severity (0–60) + corroboration (0–15) + confirmation (0–10)
 *         + scale (0–10) + recency (0–5)
 *
 * Every component is returned as a factor so the UI can explain the score.
 * Category-specific severity rules live in `severityOf`. See docs/EVENT_MODEL.md.
 */
import type { EventCategory, EventMetrics, EventStatus, ImportanceFactor } from "@/types/events";

export interface ImportanceInput {
  type: EventCategory;
  subtype: string | null;
  metrics: EventMetrics;
  independentSources: number;
  /** An authoritative final record counts as corroboration equivalent to 3 publishers. */
  officialFinal?: boolean;
  status: EventStatus;
  timestamp: string;
  isSynthetic?: boolean;
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const num = (m: EventMetrics, k: string): number | null => {
  const v = m[k];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
};
const str = (m: EventMetrics, k: string): string | null => {
  const v = m[k];
  return typeof v === "string" ? v : null;
};

const ALERT_LEVEL: Record<string, number> = { green: 0.3, yellow: 0.55, orange: 0.7, red: 0.95 };

/** Returns severity in [0,1] and a human explanation. */
export function severityOf(input: Pick<ImportanceInput, "type" | "subtype" | "metrics">): {
  value: number;
  detail: string;
} {
  const { type, subtype, metrics: m } = input;

  // Generic alert level (GDACS / USGS PAGER) takes precedence when present.
  const alert = str(m, "alert_level")?.toLowerCase();
  const alertSev = alert ? ALERT_LEVEL[alert] : undefined;

  switch (type) {
    case "EARTHQUAKE": {
      const mag = num(m, "magnitude") ?? 0;
      // M2.5 → 0, M5 → 0.45, M6 → 0.64, M7 → 0.82, M8+ → 1
      let v = clamp01((mag - 2.5) / 5.5);
      const parts = [`magnitude ${mag.toFixed(1)}`];
      if (m.tsunami === true) {
        v = clamp01(v + 0.15);
        parts.push("tsunami flag");
      }
      if (alertSev !== undefined) {
        v = Math.max(v, alertSev);
        parts.push(`${alert} alert`);
      }
      return { value: v, detail: parts.join(", ") };
    }
    case "FIRE": {
      if (alertSev !== undefined) return { value: alertSev, detail: `${alert} alert` };
      const frp = num(m, "frp_total_mw");
      const count = num(m, "detections");
      if (frp !== null) {
        // 10 MW → 0.2, 1,000 MW → 0.6, 10,000 MW+ → ~0.8
        const v = clamp01(Math.log10(Math.max(frp, 1)) / 5);
        return { value: v, detail: `${Math.round(frp)} MW radiative power, ${count ?? "?"} detections` };
      }
      return { value: 0.3, detail: "wildfire report" };
    }
    case "WEATHER": {
      if (alertSev !== undefined) return { value: alertSev, detail: `${alert} alert` };
      const sev = str(m, "severity");
      const wind = num(m, "wind_kts");
      let v = sev === "Extreme" ? 0.75 : sev === "Severe" ? 0.5 : sev === "Moderate" ? 0.3 : 0.25;
      if (str(m, "urgency") === "Immediate") v += 0.1;
      if (wind !== null) v = Math.max(v, clamp01((wind - 34) / 100 + 0.35));
      return { value: clamp01(v), detail: [sev && `${sev} severity`, wind && `${wind} kt winds`].filter(Boolean).join(", ") || "weather event" };
    }
    case "FLOOD":
    case "VOLCANO":
    case "DISASTER": {
      if (alertSev !== undefined) return { value: alertSev, detail: `${alert} alert` };
      const base = type === "VOLCANO" ? 0.45 : 0.35;
      return { value: base, detail: `${type.toLowerCase()} report without alert level` };
    }
    case "CONFLICT":
    case "PROTEST":
    case "POLITICS":
    case "NEWS":
    case "BUSINESS":
    case "MARKETS":
    case "TECHNOLOGY":
    case "SCIENCE":
    case "AVIATION":
    case "MARITIME":
    case "INFRASTRUCTURE":
    case "HEALTH":
    case "OTHER": {
      // SEC filings carry an item-based materiality weight.
      const fw = num(m, "filing_weight");
      if (fw !== null) return { value: fw, detail: `SEC item ${str(m, "sec_items") ?? ""}`.trim() };
      // Tsunami / outage alert levels
      if (alertSev !== undefined) return { value: alertSev, detail: `${alert} alert` };
      if (subtype === "internet-outage") {
        const hours = num(m, "duration_h") ?? 1;
        return { value: clamp01(0.3 + Math.min(hours / 24, 1) * 0.35), detail: `national internet disruption, ${hours} h` };
      }
      if (type === "AVIATION" && subtype) {
        const v = subtype === "closure" || subtype === "ground-stop" ? 0.4 : subtype === "ground-delay" ? 0.3 : 0.2;
        return { value: v, detail: subtype.replace(/-/g, " ") };
      }
      if (type === "HEALTH") return { value: 0.55, detail: "official outbreak report" };
      // GDELT Goldstein scale: -10 (most destabilising) … +10. Use its magnitude.
      const goldstein = num(m, "goldstein");
      const articles = num(m, "num_articles") ?? 1;
      const base = type === "CONFLICT" ? 0.25 : type === "PROTEST" ? 0.18 : 0.1;
      let v = base;
      const parts: string[] = [`${type.toLowerCase()} base`];
      if (goldstein !== null) {
        v += (Math.abs(Math.min(goldstein, 0)) / 10) * 0.25;
        parts.push(`Goldstein ${goldstein}`);
      }
      v += clamp01(Math.log10(Math.max(articles, 1)) / 2) * 0.3;
      parts.push(`${articles} articles`);
      return { value: clamp01(v), detail: parts.join(", ") };
    }
    case "SPACE": {
      const crewed = m.crewed === true;
      const v = subtype === "launch" ? (crewed ? 0.75 : 0.35) : 0.3;
      return { value: v, detail: crewed ? "crewed launch" : subtype ?? "space event" };
    }
  }
}

const CONFIRMATION_POINTS: Record<EventStatus, number> = {
  CONFIRMED: 10,
  PARTIALLY_CONFIRMED: 7,
  REPORTED: 5,
  RESOLVED: 4,
  UNVERIFIED: 0,
};

/** Population/area scale, when the source provides it. */
function scaleOf(m: EventMetrics): { value: number; detail: string } {
  const pop = num(m, "population_affected");
  if (pop !== null && pop > 0) {
    // 10k → 0.4, 1M → 0.8, 10M+ → 1
    return { value: clamp01(Math.log10(pop) / 7), detail: `${Math.round(pop).toLocaleString("en-US")} people affected (source estimate)` };
  }
  const felt = num(m, "felt_reports");
  if (felt !== null && felt > 0) return { value: clamp01(Math.log10(felt) / 4), detail: `${felt} felt reports` };
  const area = num(m, "area_km2");
  if (area !== null && area > 0) return { value: clamp01(Math.log10(area) / 6), detail: `${Math.round(area)} km² area` };
  return { value: 0, detail: "no scale data" };
}

export function calculateImportance(
  input: ImportanceInput,
  now = Date.now(),
): { score: number; factors: ImportanceFactor[] } {
  const sev = severityOf(input);
  const effectiveSources = Math.max(input.independentSources, 1) + (input.officialFinal ? 2 : 0);
  const corroboration = clamp01(Math.log2(effectiveSources) / 3); // 1→0, 2→.33, 4→.67, 8→1
  const scale = scaleOf(input.metrics);
  const ageH = (now - Date.parse(input.timestamp)) / 3_600_000;
  // Future (scheduled) events count as fresh. Linear decay to 0 over 72h.
  const recency = ageH <= 0 ? 1 : clamp01(1 - ageH / 72);

  const factors: ImportanceFactor[] = [
    { factor: "severity", points: round1(sev.value * 60), detail: sev.detail },
    {
      factor: "corroboration",
      points: round1(corroboration * 15),
      detail: `${input.independentSources} independent source(s)${input.officialFinal ? " incl. an official final record" : ""}`,
    },
    { factor: "confirmation", points: CONFIRMATION_POINTS[input.status], detail: input.status },
    { factor: "scale", points: round1(scale.value * 10), detail: scale.detail },
    { factor: "recency", points: round1(recency * 5), detail: ageH <= 0 ? "upcoming / just now" : `${Math.round(ageH)}h old` },
  ];
  const total = factors.reduce((s, f) => s + f.points, 0);
  return { score: Math.round(Math.max(0, Math.min(100, total))), factors };
}

const round1 = (n: number) => Math.round(n * 10) / 10;
