/**
 * Energy dashboard: live electricity-grid data from keyless official / open sources.
 *
 *  - Great Britain: NESO Carbon Intensity API (intensity, generation mix) + Elexon Insights
 *    (demand outturn, Market Index price).
 *  - Spain: Red Eléctrica REData (real-time peninsular demand, spot price, previous-day mix and CO₂).
 *  - France: RTE éCO2mix real-time via ODRE (consumption, production by fuel, CO₂ rate).
 *  - Germany: Bundesnetzagentur SMARD chart data (grid load, generation by fuel, day-ahead price).
 *  - Australia: AEMO NEM summary (regional demand and dispatch prices).
 *
 * Each grid loads independently; a failing grid keeps its last good copy (marked stale) or is
 * listed in `failed`. All timestamps are converted to UTC ISO strings. Cached 10 minutes.
 */
import "server-only";
import { userAgent } from "@/lib/env";

export type FuelKey = "nuclear" | "wind" | "solar" | "hydro" | "bio" | "otherRenewable" | "gas" | "coal" | "oil" | "otherFossil" | "storage" | "imports" | "other";

/** Fixed display order, label and whether the fuel counts as renewable. */
export const FUELS: Record<FuelKey, { label: string; renewable: boolean }> = {
  wind: { label: "Wind", renewable: true },
  solar: { label: "Solar", renewable: true },
  hydro: { label: "Hydro", renewable: true },
  bio: { label: "Bioenergy", renewable: true },
  otherRenewable: { label: "Other renewables", renewable: true },
  nuclear: { label: "Nuclear", renewable: false },
  gas: { label: "Gas", renewable: false },
  coal: { label: "Coal", renewable: false },
  oil: { label: "Oil", renewable: false },
  otherFossil: { label: "Other fossil", renewable: false },
  storage: { label: "Storage", renewable: false },
  imports: { label: "Imports", renewable: false },
  other: { label: "Other", renewable: false },
};
export const FUEL_ORDER = Object.keys(FUELS) as FuelKey[];

export interface Metric {
  value: number;
  unit: string;
  /** UTC ISO timestamp (start of the period), or a YYYY-MM-DD day for daily values */
  asOf: string;
  /** What the number is, e.g. "actual", "day-ahead hourly average" */
  note?: string;
}

export interface FuelShare {
  fuel: FuelKey;
  label: string;
  /** Share of generation, 0–100 (%) */
  share: number;
  /** Absolute output when the source gives it */
  value?: number;
}

export interface GenerationMix {
  asOf: string;
  /** What the shares are of, e.g. "half-hour, % of GB generation incl. imports" */
  basis: string;
  fuels: FuelShare[];
  /** Absolute unit of `value` in fuels, when present */
  unit?: string;
}

export interface RegionRow {
  id: string;
  name: string;
  demandMw: number | null;
  price: number | null;
}

export interface Grid {
  id: "GB" | "ES" | "FR" | "DE" | "NEM";
  name: string;
  /** Short attribution shown on the card */
  source: string;
  sourceUrl: string;
  demand: Metric | null;
  renewableShare: Metric | null;
  carbonIntensity: Metric | null;
  price: Metric | null;
  mix: GenerationMix | null;
  regions?: RegionRow[];
  /** Parts of this grid that could not be loaded this time (e.g. "price") */
  missing: string[];
  /** True when this copy is from an earlier refresh because the latest one failed */
  stale?: boolean;
  /** Free-text caveats */
  notes?: string[];
}

export interface EnergyDashboard {
  grids: Grid[];
  generatedAt: string;
  failed: string[];
}

const round = (v: number, d = 1) => Math.round(v * 10 ** d) / 10 ** d;
const num = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : null;
};
/** Any parseable timestamp → UTC ISO string. "2026-10-07T05:00Z" and offsets are handled by Date. */
export function toUtcIso(t: string | number): string | null {
  const ms = typeof t === "number" ? t : Date.parse(t);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/** Build a mix from absolute or percentage values per fuel: negatives dropped, shares re-normalised to 100. */
export function buildMix(parts: Array<[FuelKey, number | null]>, asOf: string, basis: string, unit?: string): GenerationMix | null {
  const sums = new Map<FuelKey, number>();
  for (const [k, v] of parts) if (v != null && v > 0) sums.set(k, (sums.get(k) ?? 0) + v);
  const total = [...sums.values()].reduce((a, b) => a + b, 0);
  if (!(total > 0)) return null;
  const fuels = FUEL_ORDER.filter((k) => sums.has(k)).map((k) => ({
    fuel: k,
    label: FUELS[k].label,
    share: round((sums.get(k)! / total) * 100, 1),
    ...(unit ? { value: round(sums.get(k)!, 0) } : {}),
  }));
  return { asOf, basis, fuels, ...(unit ? { unit } : {}) };
}

export function renewableShareOf(mix: GenerationMix | null, note?: string): Metric | null {
  if (!mix) return null;
  const share = mix.fuels.filter((f) => FUELS[f.fuel].renewable).reduce((a, f) => a + f.share, 0);
  return { value: round(share, 1), unit: "%", asOf: mix.asOf, note: note ?? mix.basis };
}

/* ───────────────────────── Great Britain ───────────────────────── */

const GB_FUEL: Record<string, FuelKey> = { biomass: "bio", coal: "coal", imports: "imports", gas: "gas", nuclear: "nuclear", other: "other", hydro: "hydro", solar: "solar", wind: "wind", storage: "storage" };

/** NESO Carbon Intensity API /intensity → gCO₂/kWh (actual when published, else forecast). */
export function parseGbIntensity(j: { data?: Array<{ from?: string; intensity?: { forecast?: number | null; actual?: number | null; index?: string } }> }): Metric | null {
  const d = j.data?.[0];
  const asOf = d?.from ? toUtcIso(d.from) : null;
  if (!d || !asOf) return null;
  const actual = num(d.intensity?.actual), forecast = num(d.intensity?.forecast);
  const value = actual ?? forecast;
  if (value == null) return null;
  return { value, unit: "gCO₂/kWh", asOf, note: `${actual != null ? "actual" : "forecast"}${d.intensity?.index ? ` · ${d.intensity.index}` : ""}` };
}

/** NESO Carbon Intensity API /generation → mix (percent of generation incl. imports). */
export function parseGbGeneration(j: { data?: { from?: string; generationmix?: Array<{ fuel: string; perc: number }> } }): GenerationMix | null {
  const asOf = j.data?.from ? toUtcIso(j.data.from) : null;
  if (!asOf) return null;
  return buildMix(
    (j.data?.generationmix ?? []).map((g) => [GB_FUEL[g.fuel] ?? "other", num(g.perc)]),
    asOf,
    "half-hour share of GB generation incl. imports",
  );
}

/** Elexon Insights /demand/outturn/summary → latest demand (MW). */
export function parseElexonDemand(rows: Array<{ startTime?: string; demand?: number }>): Metric | null {
  let best: { t: number; v: number } | null = null;
  for (const r of Array.isArray(rows) ? rows : []) {
    const t = Date.parse(r.startTime ?? ""), v = num(r.demand);
    if (Number.isFinite(t) && v != null && (!best || t > best.t)) best = { t, v };
  }
  return best ? { value: Math.round(best.v), unit: "MW", asOf: new Date(best.t).toISOString(), note: "demand outturn" } : null;
}

/** Elexon Insights Market Index (APX) → latest half-hourly price (£/MWh). Zero-volume periods are skipped. */
export function parseElexonMid(j: { data?: Array<{ startTime?: string; price?: number; volume?: number; dataProvider?: string }> }): Metric | null {
  let best: { t: number; v: number } | null = null;
  for (const r of j.data ?? []) {
    const t = Date.parse(r.startTime ?? ""), v = num(r.price);
    if (!Number.isFinite(t) || v == null || !(num(r.volume) ?? 0)) continue;
    if (!best || t > best.t) best = { t, v };
  }
  return best ? { value: round(best.v, 2), unit: "£/MWh", asOf: new Date(best.t).toISOString(), note: "Market Index Price, half-hourly" } : null;
}

/* ───────────────────────── Spain (REE) ───────────────────────── */

type ReeJson = { included?: Array<{ type?: string; attributes?: { title?: string; type?: string; values?: Array<{ value: number; datetime: string }> } }> };

/** Latest value at or before `now` from a named REE series. */
export function reeLatest(j: ReeJson, title: string, now = Date.now()): { value: number; asOf: string } | null {
  const s = j.included?.find((i) => (i.attributes?.title ?? i.type) === title);
  let best: { t: number; v: number } | null = null;
  for (const p of s?.attributes?.values ?? []) {
    const t = Date.parse(p.datetime), v = num(p.value);
    if (Number.isFinite(t) && v != null && t <= now && (!best || t > best.t)) best = { t, v };
  }
  return best ? { value: best.v, asOf: new Date(best.t).toISOString() } : null;
}

function reeFuel(title: string): FuelKey {
  const t = title.toLowerCase();
  if (t.includes("wind")) return "wind";
  if (t.includes("solar")) return "solar";
  if (t.includes("pump") || t.includes("storage") || t.includes("battery")) return "storage";
  if (t.includes("hydro")) return "hydro";
  if (t.includes("nuclear")) return "nuclear";
  if (t.includes("coal")) return "coal";
  if (t.includes("combined cycle")) return "gas";
  if (t === "renewable waste" || t.includes("other renewables")) return "otherRenewable";
  if (t.includes("diesel") || t.includes("turbine") || t.includes("cogeneration") || t.includes("waste")) return "otherFossil";
  return "other";
}

/** REE /generacion/estructura-generacion (time_trunc=day) → mix for `day` (YYYY-MM-DD, Spanish calendar day) in MWh. */
export function parseReeGeneration(j: ReeJson, day: string): GenerationMix | null {
  const parts: Array<[FuelKey, number | null]> = [];
  for (const s of j.included ?? []) {
    const title = s.attributes?.title ?? s.type ?? "";
    if (s.attributes?.type === "total" || /^total/i.test(title)) continue;
    const v = s.attributes?.values?.find((p) => p.datetime.slice(0, 10) === day);
    parts.push([reeFuel(title), v ? num(v.value) : null]);
  }
  return buildMix(parts, day, "previous day's national generation (MWh)", "MWh");
}

/** REE /generacion/no-renovables-detalle-emisiones-CO2 → gCO₂/kWh for `day` (tCO₂/MWh × 1000). */
export function parseReeCo2(j: ReeJson, day: string): Metric | null {
  const s = j.included?.find((i) => /tCO2 eq\.\/MWh/i.test(i.attributes?.title ?? i.type ?? ""));
  const v = s?.attributes?.values?.find((p) => p.datetime.slice(0, 10) === day);
  const n = v ? num(v.value) : null;
  return n == null ? null : { value: Math.round(n * 1000), unit: "gCO₂/kWh", asOf: day, note: "previous day, national generation" };
}

/** Spanish calendar date (Europe/Madrid) `offsetDays` from `now`. */
export function madridDay(now: number, offsetDays = 0): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now + offsetDays * 86_400_000));
}

/* ───────────────────────── France (RTE éCO2mix via ODRE) ───────────────────────── */

type Eco2mixRow = Record<string, string | number | null | undefined>;

/** ODRE eco2mix-national-tr record (latest, consumption and nuclear present) → demand, mix, CO₂ rate. */
export function parseEco2mix(row: Eco2mixRow | undefined): { demand: Metric; mix: GenerationMix | null; carbon: Metric | null } | null {
  if (!row) return null;
  const asOf = toUtcIso(String(row.date_heure ?? ""));
  const demand = num(row.consommation);
  if (!asOf || demand == null) return null;
  const hydro = num(row.hydraulique), step = num(row.hydraulique_step_turbinage) ?? 0;
  const storage = step + (num(row.destockage_batterie) ?? 0);
  const mix = buildMix(
    [
      ["nuclear", num(row.nucleaire)],
      ["wind", num(row.eolien)],
      ["solar", num(row.solaire)],
      ["hydro", hydro == null ? null : hydro - step],
      ["bio", num(row.bioenergies)],
      ["gas", num(row.gaz)],
      ["coal", num(row.charbon)],
      ["oil", num(row.fioul)],
      ["storage", storage],
    ],
    asOf,
    "15-min share of French production (exports/imports excluded)",
    "MW",
  );
  const co2 = num(row.taux_co2);
  return {
    demand: { value: Math.round(demand), unit: "MW", asOf, note: "consumption" },
    mix,
    carbon: co2 == null ? null : { value: co2, unit: "gCO₂/kWh", asOf, note: "RTE estimate for French production" },
  };
}

/* ───────────────────────── Germany (SMARD) ───────────────────────── */

/** SMARD filter ids (Bundesnetzagentur). Hourly series are MWh per hour = average MW. */
export const SMARD_FUELS: Array<[number, FuelKey]> = [
  [1223, "coal"], // Braunkohle (lignite)
  [4069, "coal"], // Steinkohle (hard coal)
  [1224, "nuclear"],
  [1225, "wind"], // offshore
  [4067, "wind"], // onshore
  [4068, "solar"],
  [1226, "hydro"],
  [4066, "bio"],
  [1228, "otherRenewable"],
  [4071, "gas"],
  [4070, "storage"], // Pumpspeicher
  [1227, "otherFossil"], // Sonstige Konventionelle
];
export const SMARD_LOAD = 410;
export const SMARD_PRICE = 4169;

export type SmardSeries = Array<[number, number | null]>;

/** Latest non-null point at or before `now`. */
export function smardLatest(series: SmardSeries, now = Date.now()): [number, number] | null {
  let best: [number, number] | null = null;
  for (const [t, v] of series) if (v != null && Number.isFinite(v) && t <= now && (!best || t > best[0])) best = [t, v];
  return best;
}

/** Germany: demand + mix at the latest hour where load is published; mix uses whatever fuels have a value at that hour. */
export function parseSmard(load: SmardSeries, fuels: Array<[FuelKey, SmardSeries]>, price: SmardSeries | null, now = Date.now()) {
  const last = smardLatest(load, now);
  const at = (s: SmardSeries, t: number) => s.find((p) => p[0] === t)?.[1] ?? null;
  const asOf = last ? new Date(last[0]).toISOString() : null;
  const demand: Metric | null = last && asOf ? { value: Math.round(last[1]), unit: "MW", asOf, note: "grid load, hourly average" } : null;
  const mix = last && asOf ? buildMix(fuels.map(([k, s]) => [k, at(s, last[0])]), asOf, "hourly share of German net generation", "MW") : null;
  const p = price ? smardLatest(price, now) : null;
  const priceM: Metric | null = p ? { value: round(p[1], 2), unit: "€/MWh", asOf: new Date(p[0]).toISOString(), note: "day-ahead DE-LU, hourly average" } : null;
  return { demand, mix, price: priceM };
}

/* ───────────────────────── Australia (AEMO NEM) ───────────────────────── */

const NEM_NAMES: Record<string, string> = { NSW1: "New South Wales", QLD1: "Queensland", SA1: "South Australia", TAS1: "Tasmania", VIC1: "Victoria" };

/** AEMO NEM time (AEST, UTC+10, no daylight saving) → UTC ISO. */
export function nemToUtc(s: string): string | null {
  const ms = Date.parse(`${s.replace(" ", "T").slice(0, 19)}+10:00`);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/** AEMO ELEC_NEM_SUMMARY → regional rows, total demand and demand-weighted mean price. */
export function parseNemSummary(j: { ELEC_NEM_SUMMARY?: Array<{ SETTLEMENTDATE?: string; REGIONID?: string; PRICE?: number; TOTALDEMAND?: number }> }) {
  const rows = j.ELEC_NEM_SUMMARY ?? [];
  const regions: RegionRow[] = rows
    .filter((r) => r.REGIONID)
    .map((r) => ({ id: r.REGIONID!, name: NEM_NAMES[r.REGIONID!] ?? r.REGIONID!, demandMw: num(r.TOTALDEMAND) == null ? null : Math.round(num(r.TOTALDEMAND)!), price: num(r.PRICE) == null ? null : round(num(r.PRICE)!, 2) }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const asOf = rows.map((r) => (r.SETTLEMENTDATE ? nemToUtc(r.SETTLEMENTDATE) : null)).filter(Boolean).sort().pop() ?? null;
  const withD = regions.filter((r) => r.demandMw != null);
  const total = withD.reduce((a, r) => a + r.demandMw!, 0);
  const priced = withD.filter((r) => r.price != null && r.demandMw! > 0);
  const w = priced.reduce((a, r) => a + r.demandMw!, 0);
  return {
    regions,
    demand: asOf && withD.length ? ({ value: Math.round(total), unit: "MW", asOf, note: `sum of ${withD.length} regions, 5-min dispatch` } as Metric) : null,
    price:
      asOf && w > 0
        ? ({ value: round(priced.reduce((a, r) => a + r.price! * r.demandMw!, 0) / w, 2), unit: "A$/MWh", asOf, note: "demand-weighted mean of regional dispatch prices" } as Metric)
        : null,
  };
}

/* ───────────────────────── loading ───────────────────────── */

async function get<T = unknown>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { "User-Agent": userAgent(), Accept: "application/json" }, signal: AbortSignal.timeout(20_000), cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}
/** Settle a part: value or null (recording the part name as missing). */
async function part<T>(name: string, missing: string[], run: () => Promise<T | null>): Promise<T | null> {
  try {
    const v = await run();
    if (v == null) missing.push(name);
    return v;
  } catch {
    missing.push(name);
    return null;
  }
}

async function loadGB(): Promise<Grid> {
  const missing: string[] = [];
  const now = Date.now();
  const from = new Date(now - 86_400_000).toISOString().slice(0, 16) + "Z", to = new Date(now).toISOString().slice(0, 16) + "Z";
  const [carbon, mix, demand, price] = await Promise.all([
    part("carbon intensity", missing, async () => parseGbIntensity(await get("https://api.carbonintensity.org.uk/intensity"))),
    part("generation mix", missing, async () => parseGbGeneration(await get("https://api.carbonintensity.org.uk/generation"))),
    part("demand", missing, async () => parseElexonDemand(await get("https://data.elexon.co.uk/bmrs/api/v1/demand/outturn/summary"))),
    part("price", missing, async () => parseElexonMid(await get(`https://data.elexon.co.uk/bmrs/api/v1/balancing/pricing/market-index?from=${from}&to=${to}&dataProviders=APXMIDP`))),
  ]);
  return {
    id: "GB", name: "Great Britain", source: "NESO Carbon Intensity API · Elexon Insights", sourceUrl: "https://carbonintensity.org.uk/",
    demand, carbonIntensity: carbon, price, mix, renewableShare: renewableShareOf(mix, "wind, solar, hydro and biomass, share incl. imports"), missing,
  };
}

async function loadES(): Promise<Grid> {
  const missing: string[] = [];
  const now = Date.now();
  const today = madridDay(now), yesterday = madridDay(now, -1);
  const B = "https://apidatos.ree.es/en/datos";
  const rt = `start_date=${today}T00:00&end_date=${today}T23:59&time_trunc=hour`;
  const day = `start_date=${yesterday}T00:00&end_date=${yesterday}T23:59&time_trunc=day`;
  const [demand, price, mix, carbon] = await Promise.all([
    part("demand", missing, async () => {
      const p = reeLatest(await get(`${B}/demanda/demanda-tiempo-real?${rt}`), "Real", now);
      return p ? ({ value: Math.round(p.value), unit: "MW", asOf: p.asOf, note: "peninsular demand, real-time" } as Metric) : null;
    }),
    part("price", missing, async () => {
      const p = reeLatest(await get(`${B}/mercados/precios-mercados-tiempo-real?${rt}`), "Spot market price", now);
      return p ? ({ value: round(p.value, 2), unit: "€/MWh", asOf: p.asOf, note: "day-ahead spot (OMIE) for the current period" } as Metric) : null;
    }),
    part("generation mix", missing, async () => parseReeGeneration(await get(`${B}/generacion/estructura-generacion?${day}`), yesterday)),
    part("carbon intensity", missing, async () => parseReeCo2(await get(`${B}/generacion/no-renovables-detalle-emisiones-CO2?${day}`), yesterday)),
  ]);
  return {
    id: "ES", name: "Spain", source: "Red Eléctrica (REData)", sourceUrl: "https://www.ree.es/en/datos/apidata",
    demand, price, mix, carbonIntensity: carbon, renewableShare: renewableShareOf(mix, "previous day, REE renewable technologies"), missing,
    notes: ["Mix and CO₂ are the previous Spanish calendar day; demand is the peninsular system."],
  };
}

async function loadFR(): Promise<Grid> {
  const missing: string[] = [];
  const url =
    "https://odre.opendatasoft.com/api/explore/v2.1/catalog/datasets/eco2mix-national-tr/records?where=consommation%20is%20not%20null%20and%20nucleaire%20is%20not%20null&order_by=date_heure%20desc&limit=1";
  const r = await part("all", missing, async () => parseEco2mix((await get<{ results?: Eco2mixRow[] }>(url)).results?.[0]));
  if (!r) throw new Error("no eco2mix record");
  if (!r.mix) missing.push("generation mix");
  if (!r.carbon) missing.push("carbon intensity");
  return {
    id: "FR", name: "France", source: "RTE éCO2mix (via ODRE)", sourceUrl: "https://www.rte-france.com/en/eco2mix",
    demand: r.demand, mix: r.mix, carbonIntensity: r.carbon, price: null,
    renewableShare: renewableShareOf(r.mix, "wind, solar, hydro (excl. pumped storage) and bioenergy"), missing: [...missing, "price"],
    notes: ["No keyless wholesale price feed for France; real-time data are provisional."],
  };
}

async function smardSeries(filter: number, ts: number): Promise<SmardSeries> {
  const j = await get<{ series?: SmardSeries }>(`https://www.smard.de/app/chart_data/${filter}/DE/${filter}_DE_hour_${ts}.json`);
  return j.series ?? [];
}

async function loadDE(): Promise<Grid> {
  const missing: string[] = [];
  const now = Date.now();
  const idx = await get<{ timestamps?: number[] }>(`https://www.smard.de/app/chart_data/${SMARD_LOAD}/DE/index_hour.json`);
  const stamps = (idx.timestamps ?? []).filter((t) => t <= now).sort((a, b) => a - b);
  if (!stamps.length) throw new Error("no SMARD index");
  // A new weekly file may not contain data yet; fall back to the previous week.
  let ts = stamps[stamps.length - 1];
  let load = await smardSeries(SMARD_LOAD, ts);
  if (!smardLatest(load, now) && stamps.length > 1) {
    ts = stamps[stamps.length - 2];
    load = await smardSeries(SMARD_LOAD, ts);
  }
  const [fuels, price] = await Promise.all([
    Promise.all(SMARD_FUELS.map(async ([id, k]) => [k, await smardSeries(id, ts).catch(() => [] as SmardSeries)] as [FuelKey, SmardSeries])),
    // Prices are published a day ahead, so the current hour is usually in the latest weekly file.
    smardSeries(SMARD_PRICE, stamps[stamps.length - 1]).catch(() => null),
  ]);
  const r = parseSmard(load, fuels, price, now);
  if (!r.demand) missing.push("demand");
  if (!r.mix) missing.push("generation mix");
  if (!r.price) missing.push("price");
  return {
    id: "DE", name: "Germany", source: "Bundesnetzagentur SMARD", sourceUrl: "https://www.smard.de/en",
    demand: r.demand, mix: r.mix, price: r.price, carbonIntensity: null,
    renewableShare: renewableShareOf(r.mix, "wind, solar, hydro, biomass and other renewables"), missing: [...missing, "carbon intensity"],
    notes: ["SMARD publishes no carbon-intensity series; generation data lag real time by a few hours."],
  };
}

async function loadNEM(): Promise<Grid> {
  const r = parseNemSummary(await get("https://visualisations.aemo.com.au/aemo/apps/api/report/ELEC_NEM_SUMMARY"));
  if (!r.demand) throw new Error("no NEM data");
  return {
    id: "NEM", name: "Australia (NEM)", source: "AEMO NEM data dashboard", sourceUrl: "https://aemo.com.au/en/energy-systems/electricity/national-electricity-market-nem/data-nem/data-dashboard-nem",
    demand: r.demand, price: r.price, regions: r.regions, mix: null, carbonIntensity: null, renewableShare: null,
    missing: ["generation mix", "carbon intensity"],
    notes: ["National Electricity Market (eastern and southern states; excludes WA and NT). Prices are 5-minute regional dispatch prices."],
  };
}

const LOADERS: Array<[Grid["id"], () => Promise<Grid>]> = [
  ["GB", loadGB],
  ["ES", loadES],
  ["FR", loadFR],
  ["DE", loadDE],
  ["NEM", loadNEM],
];
const hasData = (g: Grid) => !!(g.demand || g.mix || g.price || g.carbonIntensity);

const TTL = 10 * 60_000;
const g = globalThis as unknown as { __worldviewEnergy?: { at: number; value: EnergyDashboard }; __worldviewEnergyGood?: Map<string, Grid> };

async function load(): Promise<EnergyDashboard> {
  const good = (g.__worldviewEnergyGood ??= new Map());
  const failed: string[] = [];
  const grids = await Promise.all(
    LOADERS.map(async ([id, run]) => {
      try {
        const grid = await run();
        if (hasData(grid)) {
          good.set(id, grid);
          return grid;
        }
      } catch {
        /* fall through */
      }
      const prev = good.get(id);
      if (prev) return { ...prev, stale: true };
      failed.push(id);
      return null;
    }),
  );
  return { grids: grids.filter((x): x is Grid => !!x), generatedAt: new Date().toISOString(), failed };
}

export async function getEnergy(): Promise<EnergyDashboard> {
  const hit = g.__worldviewEnergy;
  if (hit && Date.now() - hit.at < TTL) return hit.value;
  const value = await load();
  if (value.grids.length || !hit) g.__worldviewEnergy = { at: Date.now(), value };
  return g.__worldviewEnergy?.value ?? value;
}
