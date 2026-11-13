/**
 * Client-side export of what's on screen: events as CSV / GeoJSON, chart series as CSV.
 * Pure builders (tested) plus a tiny browser download helper. Nothing leaves the machine.
 */

export interface ExportableEvent {
  id: string;
  timestamp: string;
  title: string;
  type: string;
  importanceScore: number;
  status: string;
  country: string | null;
  countryName?: string | null;
  latitude: number;
  longitude: number;
  primarySource: string;
  /** Source link, when the summary carries one */
  sourceUrl?: string | null;
  url?: string | null;
}

export const EVENT_COLUMNS = ["id", "time", "title", "type", "importance", "status", "country", "lat", "lon", "primary_source", "url"] as const;

/** RFC 4180 cell; also defuses spreadsheet formulas (=, +, -, @ at the start of third-party text). */
export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  let s = String(v);
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: readonly string[], rows: unknown[][]): string {
  return [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

const eventUrl = (e: ExportableEvent) => {
  const u = e.url ?? e.sourceUrl ?? null;
  return u && /^https?:\/\//i.test(u) ? u : "";
};
const round = (n: number, d = 5) => Math.round(n * 10 ** d) / 10 ** d;

export function eventsToCsv(events: ExportableEvent[]): string {
  return toCsv(
    EVENT_COLUMNS,
    events.map((e) => [e.id, e.timestamp, e.title, e.type, Math.round(e.importanceScore), e.status, e.country ?? "", round(e.latitude), round(e.longitude), e.primarySource, eventUrl(e)]),
  );
}

export function eventsToGeoJSON(events: ExportableEvent[]) {
  return {
    type: "FeatureCollection" as const,
    features: events.map((e) => ({
      type: "Feature" as const,
      id: e.id,
      geometry: { type: "Point" as const, coordinates: [round(e.longitude), round(e.latitude)] },
      properties: {
        id: e.id,
        time: e.timestamp,
        title: e.title,
        type: e.type,
        importance: Math.round(e.importanceScore),
        status: e.status,
        country: e.country,
        primary_source: e.primarySource,
        url: eventUrl(e) || null,
      },
    })),
  };
}

export function seriesToCsv(points: Array<[number, number]>, opts: { xIsTime: boolean; name: string }): string {
  return toCsv([opts.xIsTime ? "time" : "index", opts.name], points.map(([x, y]) => [opts.xIsTime ? new Date(x).toISOString() : x, y]));
}

/** "worldview-events-2026-11-12T0930" style names. */
export function exportName(prefix: string, ext: string, now = new Date()) {
  const stamp = now.toISOString().slice(0, 16).replace(/:/g, "");
  const safe = prefix.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "export";
  return `worldview-${safe}-${stamp}.${ext}`;
}

export function downloadText(filename: string, mime: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
