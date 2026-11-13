/**
 * Point weather from Open-Meteo (https://open-meteo.com) — pure helpers.
 *
 * Open-Meteo is keyless and free for non-commercial use (CC BY 4.0, attribute
 * "Weather data by Open-Meteo.com"). The server route rounds coordinates to a
 * 0.05° grid (~5 km) and caches, so nearby points share one upstream call.
 */

export const OPEN_METEO_ATTRIBUTION = "Weather data by Open-Meteo.com";
export const OPEN_METEO_URL = "https://open-meteo.com/";
export const COORD_STEP = 0.05;

/** Validate a lat/lon pair from query strings. Returns null when either is missing or out of range. */
export function parseLatLon(lat: unknown, lon: unknown): { lat: number; lon: number } | null {
  const toNum = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN);
  const a = toNum(lat);
  const o = toNum(lon);
  if (!Number.isFinite(a) || !Number.isFinite(o) || a < -90 || a > 90 || o < -180 || o > 180) return null;
  return { lat: a, lon: o };
}

/** Snap to the 0.05° grid; returns a number with at most 2 decimals. */
export function roundCoord(v: number, step = COORD_STEP): number {
  const r = Math.round(v / step) * step;
  const out = Math.round(r * 100) / 100;
  return Object.is(out, -0) ? 0 : out;
}

/** Cache key for a rounded point (+ options). */
export function weatherKey(lat: number, lon: number, opts: { marine?: boolean; flood?: boolean } = {}): string {
  return `${roundCoord(lat).toFixed(2)},${roundCoord(lon).toFixed(2)}${opts.marine ? ",m" : ""}${opts.flood ? ",f" : ""}`;
}

// ---- WMO weather codes -----------------------------------------------------------

export type WeatherIcon = "clear" | "partly" | "cloudy" | "fog" | "drizzle" | "rain" | "freezing" | "snow" | "showers" | "storm" | "unknown";

const CODES: Record<number, [string, WeatherIcon]> = {
  0: ["Clear sky", "clear"],
  1: ["Mainly clear", "clear"],
  2: ["Partly cloudy", "partly"],
  3: ["Overcast", "cloudy"],
  45: ["Fog", "fog"],
  48: ["Freezing fog", "fog"],
  51: ["Light drizzle", "drizzle"],
  53: ["Drizzle", "drizzle"],
  55: ["Dense drizzle", "drizzle"],
  56: ["Light freezing drizzle", "freezing"],
  57: ["Freezing drizzle", "freezing"],
  61: ["Light rain", "rain"],
  63: ["Rain", "rain"],
  65: ["Heavy rain", "rain"],
  66: ["Light freezing rain", "freezing"],
  67: ["Freezing rain", "freezing"],
  71: ["Light snow", "snow"],
  73: ["Snow", "snow"],
  75: ["Heavy snow", "snow"],
  77: ["Snow grains", "snow"],
  80: ["Light showers", "showers"],
  81: ["Showers", "showers"],
  82: ["Violent showers", "showers"],
  85: ["Snow showers", "snow"],
  86: ["Heavy snow showers", "snow"],
  95: ["Thunderstorm", "storm"],
  96: ["Thunderstorm with hail", "storm"],
  99: ["Thunderstorm with heavy hail", "storm"],
};

/** WMO weather interpretation code → label + icon kind. */
export function weatherCode(code: number | null | undefined): { label: string; icon: WeatherIcon } {
  const c = typeof code === "number" ? CODES[code] : undefined;
  return c ? { label: c[0], icon: c[1] } : { label: "Unknown", icon: "unknown" };
}

/** 16-point compass name for a direction in degrees. */
export function compass(deg: number | null | undefined): string {
  if (typeof deg !== "number" || !Number.isFinite(deg)) return "";
  const names = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  return names[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
}

// ---- response parsing ------------------------------------------------------------

const n = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

export interface WeatherNow {
  time: string;
  temperatureC: number | null;
  feelsLikeC: number | null;
  humidityPct: number | null;
  precipitationMm: number | null;
  code: number | null;
  windKmh: number | null;
  windDirDeg: number | null;
  gustKmh: number | null;
  isDay: boolean;
}

export interface WeatherHour {
  time: string;
  temperatureC: number | null;
  precipProbPct: number | null;
  precipitationMm: number | null;
  code: number | null;
  windKmh: number | null;
  gustKmh: number | null;
}

export interface Next24 {
  minC: number | null;
  maxC: number | null;
  precipMm: number;
  maxPrecipProbPct: number | null;
  maxGustKmh: number | null;
  /** The most significant weather code in the period (higher WMO codes are more severe). */
  worstCode: number | null;
}

export interface Forecast {
  latitude: number;
  longitude: number;
  elevationM: number | null;
  timezone: string | null;
  utcOffsetSeconds: number;
  now: WeatherNow | null;
  hours: WeatherHour[];
  next24: Next24;
}

export function parseForecast(raw: unknown): Forecast | null {
  const r = raw as Record<string, unknown> | null;
  if (!r || typeof r !== "object" || n(r.latitude) === null) return null;
  const c = r.current as Record<string, unknown> | undefined;
  const now: WeatherNow | null = c
    ? {
        time: String(c.time ?? ""),
        temperatureC: n(c.temperature_2m),
        feelsLikeC: n(c.apparent_temperature),
        humidityPct: n(c.relative_humidity_2m),
        precipitationMm: n(c.precipitation),
        code: n(c.weather_code),
        windKmh: n(c.wind_speed_10m),
        windDirDeg: n(c.wind_direction_10m),
        gustKmh: n(c.wind_gusts_10m),
        isDay: c.is_day !== 0,
      }
    : null;
  const h = (r.hourly ?? {}) as Record<string, unknown>;
  const times = arr(h.time);
  const hours: WeatherHour[] = times.slice(0, 24).map((t, i) => ({
    time: String(t),
    temperatureC: n(arr(h.temperature_2m)[i]),
    precipProbPct: n(arr(h.precipitation_probability)[i]),
    precipitationMm: n(arr(h.precipitation)[i]),
    code: n(arr(h.weather_code)[i]),
    windKmh: n(arr(h.wind_speed_10m)[i]),
    gustKmh: n(arr(h.wind_gusts_10m)[i]),
  }));
  return {
    latitude: n(r.latitude)!,
    longitude: n(r.longitude) ?? 0,
    elevationM: n(r.elevation),
    timezone: typeof r.timezone_abbreviation === "string" ? r.timezone_abbreviation : typeof r.timezone === "string" ? r.timezone : null,
    utcOffsetSeconds: n(r.utc_offset_seconds) ?? 0,
    now,
    hours,
    next24: summarizeHours(hours),
  };
}

export function summarizeHours(hours: WeatherHour[]): Next24 {
  const vals = (k: keyof WeatherHour) => hours.map((x) => x[k]).filter((v): v is number => typeof v === "number");
  const max = (a: number[]) => (a.length ? Math.max(...a) : null);
  const temps = vals("temperatureC");
  return {
    minC: temps.length ? Math.min(...temps) : null,
    maxC: max(temps),
    precipMm: Math.round(vals("precipitationMm").reduce((s, v) => s + v, 0) * 10) / 10,
    maxPrecipProbPct: max(vals("precipProbPct")),
    maxGustKmh: max(vals("gustKmh")),
    worstCode: max(vals("code")),
  };
}

export interface MarineNow {
  waveHeightM: number;
  wavePeriodS: number | null;
  waveDirDeg: number | null;
  swellHeightM: number | null;
  seaTempC: number | null;
  /** Highest wave height over the next 24 h. */
  maxWaveHeight24hM: number | null;
}

/** Marine API → current sea state. Null over land (Open-Meteo returns nulls there). */
export function parseMarine(raw: unknown): MarineNow | null {
  const r = raw as Record<string, unknown> | null;
  const c = r?.current as Record<string, unknown> | undefined;
  const wh = n(c?.wave_height);
  if (!c || wh === null) return null;
  const hourly = arr((r?.hourly as Record<string, unknown> | undefined)?.wave_height).filter((v): v is number => typeof v === "number");
  return {
    waveHeightM: wh,
    wavePeriodS: n(c.wave_period),
    waveDirDeg: n(c.wave_direction),
    swellHeightM: n(c.swell_wave_height),
    seaTempC: n(c.sea_surface_temperature),
    maxWaveHeight24hM: hourly.length ? Math.max(...hourly) : null,
  };
}

export interface RiverNow {
  /** Modelled discharge today (m³/s). */
  todayM3s: number;
  /** Highest forecast discharge over the coming days. */
  peakM3s: number | null;
  peakDate: string | null;
  /** Climatological median for today, when returned. */
  medianM3s: number | null;
}

/** Flood API (GloFAS) → river discharge near the point. Null when there's no modelled river. */
export function parseFlood(raw: unknown, today: string): RiverNow | null {
  const d = (raw as { daily?: Record<string, unknown> } | null)?.daily;
  if (!d) return null;
  const times = arr(d.time).map(String);
  const q = arr(d.river_discharge);
  const med = arr(d.river_discharge_median);
  let i = times.indexOf(today);
  if (i < 0) i = times.findIndex((t) => t >= today);
  if (i < 0) i = 0;
  const t = n(q[i]);
  if (t === null) return null;
  let peak: number | null = null;
  let peakDate: string | null = null;
  for (let j = i; j < times.length; j++) {
    const v = n(q[j]);
    if (v !== null && (peak === null || v > peak)) {
      peak = v;
      peakDate = times[j];
    }
  }
  return { todayM3s: t, peakM3s: peak, peakDate, medianM3s: n(med[i]) };
}

export interface PointWeather {
  lat: number;
  lon: number;
  forecast: Forecast | null;
  marine: MarineNow | null;
  river: RiverNow | null;
  retrievedAt: string;
  attribution: string;
}

/** Event categories whose panel shows weather regardless of location precision. */
export const WEATHER_CATEGORIES = new Set(["WEATHER", "FLOOD", "FIRE", "MARITIME", "DISASTER"]);

/** Show point weather for this event? Weather-ish categories, or any event at an exact/city location. */
export function wantsWeather(ev: { type: string; geoPrecision: string; isSynthetic?: boolean }): boolean {
  if (ev.isSynthetic) return false;
  if (WEATHER_CATEGORIES.has(ev.type)) return ev.geoPrecision !== "country";
  return ev.geoPrecision === "exact" || ev.geoPrecision === "city";
}
