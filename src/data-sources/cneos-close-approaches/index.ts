/**
 * NASA/JPL Center for Near-Earth Object Studies — SBDB Close-Approach Data API (keyless JSON,
 * `ssd-api.jpl.nasa.gov/cad.api`). Asteroids and comets passing Earth within one lunar
 * distance (384,400 km), from 7 days ago to 30 days ahead. One event per object per approach.
 *
 * A flyby has no place on Earth: events are shown at CNEOS (NASA JPL, Pasadena) and the
 * summary says so. Past approaches are computed from the fitted orbit (`OFFICIAL_FINAL`);
 * upcoming ones are predictions (`SCHEDULED`). The size range is the standard estimate from
 * absolute magnitude H for albedos 0.25–0.05, labelled as an estimate; JPL's measured
 * diameter is shown instead when it publishes one.
 */
import type { EventCandidateInput } from "@/types/events";
import { httpGet, type DataSourceConnector, type FetchContext, type ParseContext, type ParseResult } from "../types";
import { clip, makeSource } from "../official-common";

export interface CadRaw {
  fields?: string[];
  data?: Array<Array<string | null>>;
}

const AU_KM = 149_597_870.7;
const LD_AU = 0.00256955529;
const PAST_DAYS = 7;
const AHEAD_DAYS = 30;
export const CNEOS_PLACE = { lat: 34.2013, lon: -118.1714, name: "NASA JPL Center for Near-Earth Object Studies, Pasadena, California", country: "US" };

export async function fetchCad(ctx: FetchContext): Promise<CadRaw> {
  const d = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  const url = `https://ssd-api.jpl.nasa.gov/cad.api?dist-max=1LD&date-min=${d(ctx.now - PAST_DAYS * 86_400_000)}&date-max=${d(ctx.now + AHEAD_DAYS * 86_400_000)}&sort=date&fullname=true&diameter=true`;
  return (await (await httpGet(url, ctx)).json()) as CadRaw;
}

/** "2026-Oct-31 19:10" (TDB ≈ UTC within ~1 min) → ms epoch. */
export function cadTime(s: string | null | undefined): number {
  const m = s?.match(/^(\d{4})-([A-Za-z]{3})-(\d{2})\s+(\d{2}):(\d{2})$/);
  return m ? Date.parse(`${m[3]} ${m[2]} ${m[1]} ${m[4]}:${m[5]}:00 UTC`) : NaN;
}

/** Diameter range (m) from absolute magnitude H for geometric albedo 0.25 (small) … 0.05 (large). */
export function sizeFromH(h: number): [number, number] {
  const d = (p: number) => (1329 / Math.sqrt(p)) * 10 ** (-h / 5) * 1000;
  return [d(0.25), d(0.05)];
}

const fmtM = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : m >= 100 ? `${Math.round(m / 10) * 10} m` : `${Math.max(1, Math.round(m))} m`);

export function parseCad(raw: CadRaw, ctx: ParseContext): ParseResult {
  const candidates: EventCandidateInput[] = [];
  let skipped = 0;
  const f = raw.fields ?? [];
  const col = (row: Array<string | null>, name: string) => {
    const i = f.indexOf(name);
    return i >= 0 ? row[i] : null;
  };
  const seen = new Set<string>();
  for (const row of raw.data ?? []) {
    const des = col(row, "des")?.trim();
    const t = cadTime(col(row, "cd"));
    const au = Number(col(row, "dist"));
    const id = des ? `${des.replace(/\s+/g, "_")}:${col(row, "cd")?.replace(/\s+/g, "T")}` : "";
    if (!des || Number.isNaN(t) || !Number.isFinite(au) || au <= 0 || au > LD_AU * 1.0001 || seen.has(id) || ctx.now - t > PAST_DAYS * 86_400_000 || t - ctx.now > AHEAD_DAYS * 86_400_000) {
      skipped++;
      continue;
    }
    seen.add(id);
    const ld = au / LD_AU;
    const km = au * AU_KM;
    const vrel = Number(col(row, "v_rel"));
    const h = Number(col(row, "h"));
    const diamKm = Number(col(row, "diameter"));
    const name = (col(row, "fullname") ?? "").trim().replace(/^\((.*)\)$/, "$1") || des;
    const upcoming = t > ctx.now;
    const size = Number.isFinite(diamKm) && diamKm > 0
      ? `measured diameter ${fmtM(diamKm * 1000)}`
      : Number.isFinite(h) && h > 0
        ? (() => {
            const [a, b] = sizeFromH(h);
            return `estimated ${fmtM(a)}–${fmtM(b)} across (from absolute magnitude H ${h.toFixed(1)}; albedo unknown)`;
          })()
        : null;
    const sigma = col(row, "t_sigma_f");
    const when = new Date(t).toISOString();
    const distText = `${ld.toFixed(2)} lunar distances (${Math.round(km).toLocaleString("en-US")} km)`;
    candidates.push({
      type: "SPACE",
      subtype: "asteroid close approach",
      title: clip(`Asteroid ${name} ${upcoming ? "will pass" : "passed"} Earth at ${ld.toFixed(2)} lunar distances`, 300),
      summary: clip(
        `NASA/JPL CNEOS: near-Earth object ${name} ${upcoming ? "is predicted to make" : "made"} its closest approach to Earth on ${when.slice(0, 16).replace("T", " ")} UTC at ${distText} from Earth's centre` +
          `${Number.isFinite(vrel) ? `, at ${vrel.toFixed(1)} km/s relative to Earth` : ""}.` +
          `${size ? ` Size: ${size}.` : ""}${sigma ? ` Timing uncertainty ±${sigma.replace(/^<\s*/, "<")} (hh:mm).` : ""}` +
          " A flyby has no location on Earth; shown at CNEOS, NASA JPL, Pasadena.",
        1990,
      ),
      description: null,
      latitude: CNEOS_PLACE.lat,
      longitude: CNEOS_PLACE.lon,
      geoPrecision: "approximate",
      locationName: "Near-Earth space (shown at NASA JPL CNEOS)",
      country: null,
      timestamp: when,
      metrics: {
        distance_ld: Math.round(ld * 1000) / 1000,
        distance_km: Math.round(km),
        velocity_km_s: Number.isFinite(vrel) ? Math.round(vrel * 100) / 100 : null,
        abs_magnitude_h: Number.isFinite(h) ? h : null,
        diameter_km: Number.isFinite(diamKm) && diamKm > 0 ? diamKm : null,
      },
      entities: [{ type: "OTHER", name, code: des }],
      source: makeSource({
        dataSourceId: "cneos-close-approaches",
        externalId: id,
        sourceName: "NASA/JPL Center for Near-Earth Object Studies (CNEOS)",
        sourceUrl: `https://ssd.jpl.nasa.gov/tools/sbdb_lookup.html#/?sstr=${encodeURIComponent(des)}`,
        title: null,
        publishedAt: null,
        retrievedAt: ctx.retrievedAt,
        sourceType: "SCIENTIFIC",
        assertion: upcoming ? "SCHEDULED" : "OFFICIAL_FINAL",
        basis: "NASA Jet Propulsion Laboratory Solar System Dynamics group (orbit computations)",
      }),
      rawData: { des, cd: col(row, "cd"), dist: col(row, "dist"), h: col(row, "h") },
    });
  }
  return { candidates, skipped };
}

export const cneosCloseApproachesConnector: DataSourceConnector<CadRaw> = {
  id: "cneos-close-approaches",
  name: "Asteroid close approaches (NASA CNEOS)",
  description: "Asteroids and comets passing Earth within one lunar distance, from 7 days ago to 30 days ahead, from NASA/JPL's close-approach data.",
  homepage: "https://cneos.jpl.nasa.gov/ca/",
  attribution: "NASA/JPL-Caltech Solar System Dynamics — SBDB Close-Approach Data API (public U.S. government data)",
  sourceType: "SCIENTIFIC",
  categories: ["SPACE"],
  refreshIntervalMs: 6 * 60 * 60_000,
  mode: "live",
  fetch: fetchCad,
  parse: parseCad,
};
