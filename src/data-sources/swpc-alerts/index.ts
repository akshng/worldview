/**
 * NOAA Space Weather Prediction Center alerts, watches and summaries (keyless JSON,
 * `products/alerts.json`, ~30 days of messages). Only messages on a NOAA space-weather scale
 * become events: geomagnetic storms (G1–G5), radio blackouts (R1–R5) and solar radiation
 * storms (S1–S5), plus geomagnetic-storm watches. Warnings (forecast thresholds that the later
 * alert confirms), electron-flux, K4, radio-burst and sudden-impulse messages are skipped.
 *
 * Placement: a radio blackout affects the sunlit hemisphere, so it is shown at the subsolar
 * point at the flare time (region precision, the summary says so). Geomagnetic and radiation
 * storms are planet-wide (high latitudes first) and are shown at NOAA SWPC in Boulder, CO.
 */
import type { EventCandidateInput } from "@/types/events";
import { httpGet, type DataSourceConnector, type FetchContext, type ParseContext, type ParseResult } from "../types";
import { clip, makeSource } from "../official-common";

export interface SwpcMessage {
  product_id?: string;
  issue_datetime?: string;
  message?: string;
}
export interface SwpcRaw {
  messages: SwpcMessage[];
}

const ALERTS_URL = "https://services.swpc.noaa.gov/products/alerts.json";
const MAX_AGE_MS = 3 * 86_400_000;
export const SWPC_HQ = { lat: 39.9915, lon: -105.2615, name: "NOAA Space Weather Prediction Center, Boulder, CO", country: "US" };

export async function fetchSwpc(ctx: FetchContext): Promise<SwpcRaw> {
  const json = (await (await httpGet(ALERTS_URL, ctx)).json()) as unknown;
  return { messages: Array.isArray(json) ? (json as SwpcMessage[]) : [] };
}

/** "2026 Nov 01 0117 UTC" → ISO, else null. */
export function swpcTime(s: string | undefined | null): string | null {
  const m = s?.match(/(\d{4})\s+([A-Z][a-z]{2})\s+(\d{1,2})\s+(\d{2})(\d{2})\s*UTC/);
  if (!m) return null;
  const t = Date.parse(`${m[3]} ${m[2]} ${m[1]} ${m[4]}:${m[5]}:00 UTC`);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

/** "2026-11-02 12:03:53.987" (UTC) → ISO. */
function issueTime(s: string | undefined): string | null {
  if (!s) return null;
  const t = Date.parse(`${s.trim().replace(" ", "T")}Z`);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

export interface SwpcFields {
  code: string;
  serial: string;
  /** "ALERT", "CONTINUED ALERT", "WATCH", "SUMMARY", "WARNING", "CANCEL WATCH", … */
  kind: string;
  headline: string;
  /** "G1 - Minor" → { letter: "G", level: 1, label: "Minor" } (highest scale named) */
  scale: { letter: "G" | "R" | "S"; level: number; label: string } | null;
  lines: Record<string, string>;
  previousSerial: string | null;
  text: string;
}

const SCALE_LABEL: Record<number, string> = { 1: "Minor", 2: "Moderate", 3: "Strong", 4: "Severe", 5: "Extreme" };

export function readSwpcMessage(message: string): SwpcFields | null {
  const text = message.replace(/\r/g, "");
  const all = text.split("\n").map((l) => l.trim());
  const lines: Record<string, string> = {};
  for (const l of all) {
    const m = l.match(/^([A-Za-z][A-Za-z0-9 /().-]{1,40}?)\s*:\s*(.*)$/);
    if (m && !(m[1].toLowerCase() in lines)) lines[m[1].toLowerCase()] = m[2].trim();
  }
  const code = lines["space weather message code"];
  const serial = lines["serial number"];
  const head = all.find((l) => /^(CONTINUED |EXTENDED |CANCEL )?(ALERT|WARNING|WATCH|SUMMARY)\s*:/.test(l));
  if (!code || !serial || !head) return null;
  const [kind, ...rest] = head.split(":");
  // A scale only counts where NOAA states it ("NOAA Scale: G1 - Minor", "Category G1 Predicted").
  let scale: SwpcFields["scale"] = null;
  for (const m of text.matchAll(/(?:noaa scale:|category)\s*([GRS])([1-5])\b/gi)) {
    const level = Number(m[2]);
    if (!scale || level > scale.level) scale = { letter: m[1].toUpperCase() as "G" | "R" | "S", level, label: SCALE_LABEL[level] };
  }
  const prev = lines["continuation of serial number"] ?? lines["extension to serial number"] ?? lines["cancel serial number"] ?? null;
  return { code, serial, kind: kind.trim().toUpperCase(), headline: rest.join(":").trim().replace(/\s+/g, " "), scale, lines, previousSerial: prev, text };
}

/** Subsolar point (lat, lon) at a time — where the Sun is overhead. Accurate to ~0.5°. */
export function subsolarPoint(iso: string): { lat: number; lon: number } {
  const d = new Date(iso);
  const start = Date.UTC(d.getUTCFullYear(), 0, 1);
  const day = (d.getTime() - start) / 86_400_000;
  const g = (2 * Math.PI * day) / 365.25;
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const eqTimeMin = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const utcMin = d.getUTCHours() * 60 + d.getUTCMinutes() + d.getUTCSeconds() / 60;
  let lon = -((utcMin + eqTimeMin - 720) / 4);
  lon = ((((lon + 180) % 360) + 360) % 360) - 180;
  return { lat: Math.round(((decl * 180) / Math.PI) * 100) / 100, lon: Math.round(lon * 100) / 100 };
}

const PHENOMENON: Record<"G" | "R" | "S", string> = { G: "geomagnetic storm", R: "radio blackout", S: "solar radiation storm" };

export function parseSwpc(raw: SwpcRaw, ctx: ParseContext): ParseResult {
  const candidates: EventCandidateInput[] = [];
  let skipped = 0;
  const seen = new Set<string>();
  for (const m of raw.messages ?? []) {
    const f = m.message ? readSwpcMessage(m.message) : null;
    const issued = issueTime(m.issue_datetime) ?? swpcTime(f?.lines["issue time"]);
    const base = f?.kind.replace(/^(CONTINUED|EXTENDED) /, "");
    if (
      !f || !issued || !f.scale || ctx.now - Date.parse(issued) > MAX_AGE_MS ||
      // Warnings forecast a threshold that the alert then confirms; cancellations end nothing we show.
      f.kind.startsWith("CANCEL") || base === "WARNING" ||
      (base === "WATCH" && f.scale.letter !== "G")
    ) {
      skipped++;
      continue;
    }
    const externalId = `${f.code}:${f.serial}`;
    if (seen.has(externalId)) {
      skipped++;
      continue;
    }
    seen.add(externalId);
    const s = f.scale;
    const phenomenon = PHENOMENON[s.letter];
    const at = swpcTime(f.lines["maximum time"] ?? f.lines["threshold reached"] ?? f.lines["begin time"]) ?? issued;
    const dayside = s.letter === "R";
    const pt = dayside ? subsolarPoint(at) : null;
    const isWatch = base === "WATCH";
    const k = f.headline.match(/K-index of (\d)/)?.[1];
    const kIndex = k ? Number(k) : null;
    const title = clip(`${isWatch ? "Watch: " : ""}${s.letter}${s.level} (${s.label}) ${phenomenon}${isWatch ? " predicted" : ""} — NOAA SWPC: ${f.headline}`);
    const facts = [
      f.lines["xray class"] ? `X-ray class ${f.lines["xray class"]}` : null,
      f.lines["location"] ? `solar location ${f.lines["location"]}` : null,
      f.lines["synoptic period"] ? `synoptic period ${f.lines["synoptic period"]} UTC` : null,
      f.lines["station"] ? `station ${f.lines["station"]}` : null,
    ].filter(Boolean);
    const days = isWatch ? f.text.match(/Highest Storm Level Predicted by Day:\s*\n?([^\n]+)/)?.[1]?.trim().replace(/\s{3,}/g, "; ").replace(/\s+/g, " ") : null;
    const impacts = f.text.match(/Potential Impacts:\s*([^\n]+)/)?.[1]?.trim();
    candidates.push({
      type: "SPACE",
      subtype: isWatch ? `${phenomenon} watch` : phenomenon,
      title,
      summary: clip(
        `NOAA SWPC ${f.kind.toLowerCase()} (${f.code}, serial ${f.serial}) issued ${issued.slice(0, 16).replace("T", " ")} UTC: ${f.headline}. NOAA scale ${s.letter}${s.level} (${s.label}).` +
          `${facts.length ? ` ${facts.join("; ")}.` : ""}${days ? ` Predicted by day: ${days}.` : ""}${impacts ? ` ${impacts}` : ""}` +
          (dayside
            ? " A radio blackout affects HF radio on the sunlit side of Earth; shown at the subsolar point at the time of the flare (approximate)."
            : " A planet-wide phenomenon, strongest at high latitudes; shown at NOAA SWPC, Boulder, CO."),
        1990,
      ),
      description: null,
      latitude: pt ? pt.lat : SWPC_HQ.lat,
      longitude: pt ? pt.lon : SWPC_HQ.lon,
      geoPrecision: pt ? "approximate" : "city",
      locationName: pt ? "Subsolar point (sunlit hemisphere)" : SWPC_HQ.name,
      country: pt ? null : "US",
      timestamp: at,
      metrics: { noaa_scale: `${s.letter}${s.level}`, scale_level: s.level, message_code: f.code, xray_class: f.lines["xray class"] ?? null, k_index: kIndex },
      entities: [{ type: "ORGANIZATION", name: "NOAA Space Weather Prediction Center", code: "SWPC" }],
      supersedes: f.previousSerial ? [`swpc-alerts:${f.code}:${f.previousSerial}`] : [],
      source: makeSource({
        dataSourceId: "swpc-alerts",
        externalId,
        sourceName: "NOAA Space Weather Prediction Center",
        sourceUrl: "https://www.swpc.noaa.gov/products/alerts-watches-and-warnings",
        title: f.headline,
        publishedAt: issued,
        retrievedAt: ctx.retrievedAt,
        assertion: isWatch ? "SCHEDULED" : "OFFICIAL_PRELIMINARY",
        basis: "U.S. federal agency (NOAA National Weather Service, Space Weather Prediction Center)",
      }),
      rawData: { product_id: m.product_id, code: f.code, serial: f.serial, issue_datetime: m.issue_datetime },
    });
  }
  return { candidates, skipped };
}

export const swpcAlertsConnector: DataSourceConnector<SwpcRaw> = {
  id: "swpc-alerts",
  name: "NOAA space weather alerts",
  description: "NOAA SWPC alerts and watches on the NOAA space-weather scales: geomagnetic storms (G), radio blackouts (R) and solar radiation storms (S), last 3 days.",
  homepage: "https://www.swpc.noaa.gov/products/alerts-watches-and-warnings",
  attribution: "NOAA Space Weather Prediction Center — public domain U.S. government data",
  sourceType: "OFFICIAL_AGENCY",
  categories: ["SPACE"],
  refreshIntervalMs: 10 * 60_000,
  timeoutMs: 20_000,
  mode: "live",
  fetch: fetchSwpc,
  parse: parseSwpc,
};
