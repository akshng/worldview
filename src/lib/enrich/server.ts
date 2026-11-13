import "server-only";
/**
 * Server side of the event enrichments: a small TTL cache with in-flight
 * de-duplication and an honest JSON fetcher. Everything is lazy — nothing runs
 * until a panel or the drop-in HUD asks for it.
 */
import { userAgent } from "@/lib/env";
import {
  parseMmiContours,
  parsePagerAlerts,
  parsePagerExposures,
  parseUsgsDetail,
  type EarthquakeContext,
  type MmiContours,
} from "./usgs";
import { parseFlood, parseForecast, parseMarine, roundCoord, OPEN_METEO_ATTRIBUTION, type PointWeather } from "./weather";

export class UpstreamError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

interface Entry<T> {
  at: number;
  ttl: number;
  value?: T;
  error?: UpstreamError;
}

/** TTL cache with a size cap (oldest out first) and shared in-flight promises. */
export class TtlCache<T> {
  private store = new Map<string, Entry<T>>();
  private inflight = new Map<string, Promise<T>>();
  constructor(
    private ttlMs: number,
    private max = 500,
    private errorTtlMs = 2 * 60_000,
    private now: () => number = Date.now,
  ) {}

  async get(key: string, load: () => Promise<T>): Promise<T> {
    const hit = this.store.get(key);
    if (hit && this.now() - hit.at < hit.ttl) {
      if (hit.error) throw hit.error;
      return hit.value as T;
    }
    const pending = this.inflight.get(key);
    if (pending) return pending;
    const p = load()
      .then((value) => {
        this.set(key, { at: this.now(), ttl: this.ttlMs, value });
        return value;
      })
      .catch((err: unknown) => {
        // Remember failures briefly so a refusing/rate-limiting upstream isn't hammered.
        const e = err instanceof UpstreamError ? err : new UpstreamError((err as Error)?.message ?? "Upstream failed", 502);
        this.set(key, { at: this.now(), ttl: e.status === 404 ? this.ttlMs : this.errorTtlMs, error: e });
        throw e;
      })
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }

  private set(key: string, e: Entry<T>) {
    this.store.delete(key);
    this.store.set(key, e);
    while (this.store.size > this.max) this.store.delete(this.store.keys().next().value as string);
  }

  get size() {
    return this.store.size;
  }
}

export async function fetchJson(url: string, timeoutMs = 10_000): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "User-Agent": userAgent(), Accept: "application/json, application/geo+json" },
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
  } catch (e) {
    throw new UpstreamError(`Upstream unreachable: ${(e as Error).message}`, 504);
  }
  if (!res.ok) throw new UpstreamError(`Upstream answered HTTP ${res.status}`, res.status === 404 || res.status === 204 ? 404 : 502);
  if (res.status === 204) throw new UpstreamError("No content", 404);
  return res.json();
}

// ---- USGS ---------------------------------------------------------------------------

const detailCache = new TtlCache<EarthquakeContext | null>(10 * 60_000, 300);
const contourCache = new TtlCache<MmiContours>(30 * 60_000, 60);
// Keep the product URLs we resolved so the contour route never follows a client-supplied URL.
const contourUrls = new Map<string, string>();

export function usgsDetailUrl(id: string): string {
  return `https://earthquake.usgs.gov/fdsnws/event/1/query?eventid=${encodeURIComponent(id)}&format=geojson`;
}

async function loadDetail(id: string) {
  const raw = await fetchJson(usgsDetailUrl(id));
  const d = parseUsgsDetail(raw, id);
  if (!d) throw new UpstreamError("Unexpected USGS response", 502);
  return d;
}

export function earthquakeContext(id: string): Promise<EarthquakeContext | null> {
  return detailCache.get(id, async () => {
    const d = await loadDetail(id);
    if (d.shakemap?.contoursUrl) contourUrls.set(id, d.shakemap.contoursUrl);
    if (contourUrls.size > 300) contourUrls.delete(contourUrls.keys().next().value as string);
    const [alerts, exposures] = await Promise.all([
      d.pager?.alertsUrl ? fetchJson(d.pager.alertsUrl).catch(() => null) : null,
      d.pager?.exposuresUrl ? fetchJson(d.pager.exposuresUrl).catch(() => null) : null,
    ]);
    const pa = alerts ? parsePagerAlerts(alerts) : { fatalities: null, losses: null };
    return {
      id: d.id,
      title: d.title,
      magnitude: d.magnitude,
      eventUrl: d.eventUrl,
      tsunamiFlag: d.tsunamiFlag,
      feltReports: d.feltReports,
      shakemap: d.shakemap
        ? { maxMmi: d.shakemap.maxMmi, status: d.shakemap.status, hasContours: !!d.shakemap.contoursUrl, pageUrl: d.shakemap.pageUrl }
        : null,
      pager: d.pager
        ? {
            level: d.pager.level,
            fatalities: pa.fatalities,
            losses: pa.losses,
            exposure: exposures ? parsePagerExposures(exposures) : [],
            pageUrl: d.pager.pageUrl,
          }
        : null,
      dyfi: d.dyfi,
      retrievedAt: new Date().toISOString(),
    };
  });
}

export function shakemapContours(id: string): Promise<MmiContours> {
  return contourCache.get(id, async () => {
    let url = contourUrls.get(id);
    if (!url) {
      const d = await loadDetail(id);
      url = d.shakemap?.contoursUrl ?? undefined;
    }
    if (!url) throw new UpstreamError("No ShakeMap contours for this event", 404);
    return parseMmiContours(await fetchJson(url, 15_000));
  });
}

// ---- Open-Meteo ---------------------------------------------------------------------

const weatherCache = new TtlCache<PointWeather>(20 * 60_000, 400);

const CURRENT = "temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m,is_day";
const HOURLY = "temperature_2m,precipitation_probability,precipitation,weather_code,wind_speed_10m,wind_gusts_10m";

export function forecastUrl(lat: number, lon: number): string {
  return `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=${CURRENT}&hourly=${HOURLY}&forecast_hours=24&timezone=auto&wind_speed_unit=kmh`;
}
export function marineUrl(lat: number, lon: number): string {
  return `https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lon}&current=wave_height,wave_period,wave_direction,swell_wave_height,sea_surface_temperature&hourly=wave_height&forecast_hours=24&timezone=auto`;
}
export function floodUrl(lat: number, lon: number): string {
  return `https://flood-api.open-meteo.com/v1/flood?latitude=${lat}&longitude=${lon}&daily=river_discharge,river_discharge_median&forecast_days=7`;
}

/** Points at or below this ground elevation (or flagged maritime) also get the Marine API. */
const MARINE_MAX_ELEVATION_M = 30;

export function pointWeather(lat: number, lon: number, opts: { marine?: boolean; flood?: boolean }): Promise<PointWeather> {
  const la = roundCoord(lat);
  const lo = roundCoord(lon);
  const key = `${la.toFixed(2)},${lo.toFixed(2)}${opts.marine ? ",m" : ""}${opts.flood ? ",f" : ""}`;
  return weatherCache.get(key, async () => {
    const forecast = parseForecast(await fetchJson(forecastUrl(la, lo)));
    // Only ask the Marine API near sea level (it answers nulls inland), or when asked to.
    const coastal = opts.marine || (forecast?.elevationM !== null && forecast?.elevationM !== undefined && forecast.elevationM <= MARINE_MAX_ELEVATION_M);
    const [marine, river] = await Promise.all([
      coastal ? fetchJson(marineUrl(la, lo)).then(parseMarine).catch(() => null) : null,
      opts.flood
        ? fetchJson(floodUrl(la, lo))
            .then((r) => parseFlood(r, new Date().toISOString().slice(0, 10)))
            .catch(() => null)
        : null,
    ]);
    return { lat: la, lon: lo, forecast, marine, river, retrievedAt: new Date().toISOString(), attribution: OPEN_METEO_ATTRIBUTION };
  });
}
