/**
 * Planet dashboard: climate and space-weather indicators from keyless public
 * scientific sources. Cached 3 hours (space weather) — most series are daily or monthly.
 */
import "server-only";
import { userAgent } from "@/lib/env";
import type { MacroIndicator, Observation } from "@/lib/finance/macro";
import { sparkOf } from "@/lib/finance/macro";

export type PlanetGroup = "Climate" | "Space weather";
export type PlanetIndicator = Omit<MacroIndicator, "group"> & { group: PlanetGroup };

export interface PlanetDashboard {
  indicators: PlanetIndicator[];
  generatedAt: string;
  failed: string[];
}

const round = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d;
const ymd = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/** Value on the same calendar day a year earlier (or the closest earlier day within a week). */
export function yearAgo(series: Observation[], date: string): Observation | null {
  const target = Date.parse(date) - 365 * 86_400_000;
  let best: Observation | null = null;
  for (const o of series) {
    const t = Date.parse(o.date);
    if (t <= target && target - t <= 7 * 86_400_000 && (!best || t > Date.parse(best.date))) best = o;
  }
  return best;
}

/** NOAA GML Mauna Loa daily CO₂: "year,month,day,decimal,ppm" with # comments. */
export function parseCo2Daily(csv: string): Observation[] {
  const out: Observation[] = [];
  for (const line of csv.split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const [y, m, d, , v] = line.split(",").map((x) => x.trim());
    const value = Number(v);
    if (/^\d{4}$/.test(y) && Number.isFinite(value) && value > 0) out.push({ date: ymd(+y, +m, +d), value });
  }
  return out;
}

/** NSIDC Sea Ice Index daily extent CSV (two header lines). */
export function parseSeaIce(csv: string): Observation[] {
  const out: Observation[] = [];
  for (const line of csv.split(/\r?\n/).slice(2)) {
    const [y, m, d, v] = line.split(",").map((x) => x.trim());
    const value = Number(v);
    if (/^\d{4}$/.test(y) && Number.isFinite(value) && value > 0) out.push({ date: ymd(+y, +m, +d), value });
  }
  return out;
}

/** CPC Oceanic Niño Index: " SEAS  YR   TOTAL   ANOM". */
export function parseOni(text: string): Array<{ season: string; year: number; anom: number }> {
  const out: Array<{ season: string; year: number; anom: number }> = [];
  for (const line of text.split(/\r?\n/).slice(1)) {
    const [season, yr, , anom] = line.trim().split(/\s+/);
    if (season && /^\d{4}$/.test(yr) && Number.isFinite(Number(anom))) out.push({ season, year: +yr, anom: Number(anom) });
  }
  return out;
}

export function ensoLabel(anom: number): string {
  if (anom >= 1.5) return "Strong El Niño";
  if (anom >= 0.5) return "El Niño";
  if (anom <= -1.5) return "Strong La Niña";
  if (anom <= -0.5) return "La Niña";
  return "Neutral";
}

export function kpLabel(kp: number): string {
  if (kp >= 9) return "G5 extreme storm";
  if (kp >= 8) return "G4 severe storm";
  if (kp >= 7) return "G3 strong storm";
  if (kp >= 6) return "G2 moderate storm";
  if (kp >= 5) return "G1 minor storm";
  if (kp >= 4) return "Active";
  return "Quiet";
}

async function get(url: string, as: "text" | "json") {
  const res = await fetch(url, { headers: { "User-Agent": userAgent() }, signal: AbortSignal.timeout(45_000), cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return as === "json" ? res.json() : res.text();
}

function yoyIndicator(meta: Omit<PlanetIndicator, "value" | "previous" | "change" | "asOf" | "spark" | "changeBasis">, series: Observation[], digits = 2): PlanetIndicator | null {
  const last = series[series.length - 1];
  if (!last) return null;
  const prior = yearAgo(series, last.date);
  return {
    ...meta,
    value: round(last.value, digits),
    previous: prior ? round(prior.value, digits) : null,
    change: prior ? round(last.value - prior.value, digits) : null,
    changeBasis: "vs a year earlier",
    asOf: last.date,
    spark: sparkOf(series.filter((o) => Date.parse(o.date) >= Date.parse(last.date) - 3 * 365 * 86_400_000)).map((v) => round(v, digits)),
  };
}

async function load(): Promise<PlanetDashboard> {
  const tasks: Array<[string, () => Promise<PlanetIndicator | null>]> = [
    [
      "CO2",
      async () =>
        yoyIndicator(
          { id: "CO2", name: "CO₂ (Mauna Loa)", group: "Climate", unit: "ppm", note: "Daily mean atmospheric carbon dioxide at Mauna Loa Observatory, Hawaii", source: "NOAA Global Monitoring Laboratory", sourceUrl: "https://gml.noaa.gov/ccgg/trends/" },
          parseCo2Daily(await get("https://gml.noaa.gov/webdata/ccgg/trends/co2/co2_daily_mlo.csv", "text")),
        ),
    ],
    [
      "GLOBAL_TEMP",
      async () => {
        const j = (await get(`https://www.ncei.noaa.gov/access/monitoring/climate-at-a-glance/global/time-series/globe/land_ocean/1/0/2015-${new Date().getUTCFullYear()}/data.json`, "json")) as { data?: Record<string, { departure?: number } | number> };
        const series = Object.entries(j.data ?? {})
          .map(([k, v]) => ({ date: `${k.slice(0, 4)}-${k.slice(4, 6)}-01`, value: typeof v === "number" ? v : Number(v?.departure) }))
          .filter((o) => Number.isFinite(o.value))
          .sort((a, b) => a.date.localeCompare(b.date));
        const last = series[series.length - 1], prev = series[series.length - 2];
        if (!last) return null;
        return {
          id: "GLOBAL_TEMP", name: "Global temperature", group: "Climate", unit: "°C",
          note: "Monthly global land + ocean surface temperature, departure from the 1901–2000 average",
          value: round(last.value), previous: prev ? round(prev.value) : null, change: prev ? round(last.value - prev.value) : null, changeBasis: "vs the previous month",
          asOf: last.date, spark: series.slice(-36).map((o) => round(o.value)), source: "NOAA NCEI Climate at a Glance", sourceUrl: "https://www.ncei.noaa.gov/access/monitoring/climate-at-a-glance/global/time-series",
        };
      },
    ],
    [
      "ARCTIC_ICE",
      async () =>
        yoyIndicator(
          { id: "ARCTIC_ICE", name: "Arctic sea ice", group: "Climate", unit: "Mkm²", note: "Daily Arctic sea ice extent, million km² (5-day trailing data may be revised)", source: "NSIDC Sea Ice Index", sourceUrl: "https://nsidc.org/arcticseaicenews/" },
          parseSeaIce(await get("https://noaadata.apps.nsidc.org/NOAA/G02135/north/daily/data/N_seaice_extent_daily_v4.0.csv", "text")).slice(-4000),
        ),
    ],
    [
      "ENSO",
      async () => {
        const rows = parseOni(await get("https://www.cpc.ncep.noaa.gov/data/indices/oni.ascii.txt", "text"));
        const last = rows[rows.length - 1], prev = rows[rows.length - 2];
        if (!last) return null;
        return {
          id: "ENSO", name: "El Niño index (ONI)", group: "Climate", unit: "°C",
          note: "Oceanic Niño Index: 3-month mean sea-surface temperature anomaly in the Niño 3.4 region. ≥ +0.5 El Niño, ≤ −0.5 La Niña",
          value: last.anom, previous: prev?.anom ?? null, change: prev ? round(last.anom - prev.anom) : null, changeBasis: "vs the previous 3-month season",
          asOf: `${last.season} ${last.year}`, spark: rows.slice(-36).map((r) => r.anom), label: ensoLabel(last.anom),
          source: "NOAA Climate Prediction Center", sourceUrl: "https://origin.cpc.ncep.noaa.gov/products/analysis_monitoring/ensostuff/ONI_v5.php",
        };
      },
    ],
    [
      "KP",
      async () => {
        const rows = (await get("https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json", "json")) as Array<{ time_tag: string; Kp: number } | string[]>;
        // Newer format: objects; older: header row + arrays.
        const pts = rows
          .map((r) => (Array.isArray(r) ? { t: r[0], kp: Number(r[1]) } : { t: r.time_tag, kp: Number(r.Kp) }))
          .filter((p) => Number.isFinite(p.kp) && /^\d{4}-/.test(p.t));
        const last = pts[pts.length - 1], prev = pts[pts.length - 2];
        if (!last) return null;
        return {
          id: "KP", name: "Geomagnetic activity (Kp)", group: "Space weather", unit: "index",
          note: "Planetary K-index, 3-hourly, 0–9. Kp ≥ 5 is a geomagnetic storm (aurora further from the poles, possible effects on power grids, GPS and radio)",
          value: round(last.kp), previous: prev ? round(prev.kp) : null, change: prev ? round(last.kp - prev.kp) : null, changeBasis: "vs 3 hours earlier",
          asOf: `${last.t.slice(0, 16).replace("T", " ")} UTC`, spark: pts.slice(-24).map((p) => p.kp), label: kpLabel(last.kp),
          source: "NOAA Space Weather Prediction Center", sourceUrl: "https://www.swpc.noaa.gov/products/planetary-k-index",
        };
      },
    ],
    [
      "SWPC_SCALES",
      async () => {
        const j = (await get("https://services.swpc.noaa.gov/products/noaa-scales.json", "json")) as Record<string, { DateStamp: string; R?: { Scale: string | null; Text?: string }; S?: { Scale: string | null }; G?: { Scale: string | null } }>;
        const now = j["0"];
        if (!now) return null;
        const r = Number(now.R?.Scale ?? 0), s = Number(now.S?.Scale ?? 0), g = Number(now.G?.Scale ?? 0);
        const worst = Math.max(r, s, g);
        return {
          id: "SWPC_SCALES", name: "Space weather scales", group: "Space weather", unit: "index",
          note: "NOAA scales right now: R radio blackouts, S solar radiation storms, G geomagnetic storms (each 0 none – 5 extreme)",
          value: worst, previous: null, change: null, asOf: now.DateStamp, spark: [], label: `R${r} · S${s} · G${g}`,
          source: "NOAA Space Weather Prediction Center", sourceUrl: "https://www.swpc.noaa.gov/noaa-scales-explanation",
        };
      },
    ],
  ];
  const indicators: PlanetIndicator[] = [];
  const failed: string[] = [];
  await Promise.all(
    tasks.map(async ([id, run]) => {
      try {
        const m = await run();
        if (m) indicators.push(m);
        else failed.push(id);
      } catch {
        failed.push(id);
      }
    }),
  );
  const order = tasks.map(([id]) => id);
  indicators.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  return { indicators, generatedAt: new Date().toISOString(), failed };
}

const TTL = 3 * 3_600_000;
const g = globalThis as unknown as { __worldviewPlanet?: { at: number; value: PlanetDashboard } };

export async function getPlanetDashboard(): Promise<PlanetDashboard> {
  const hit = g.__worldviewPlanet;
  if (hit && Date.now() - hit.at < TTL) return hit.value;
  const value = await load();
  if (value.indicators.length || !hit) g.__worldviewPlanet = { at: Date.now(), value };
  return g.__worldviewPlanet?.value ?? value;
}
