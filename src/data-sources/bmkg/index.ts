/**
 * Indonesia BMKG earthquakes (keyless JSON at data.bmkg.go.id):
 *  - gempaterkini.json   — the latest 15 M5+ earthquakes, with tsunami potential
 *  - gempadirasakan.json — the latest 15 felt earthquakes, with felt intensities (MMI)
 * Merged by origin time. `DateTime` is UTC; when it is missing, the local date/time
 * ("06 Okt 2026", "20:11:23 WIB") is converted (WIB = UTC+7, WITA = UTC+8, WIT = UTC+9).
 */
import type { EventCandidateInput } from "@/types/events";
import { httpGet, type DataSourceConnector, type FetchContext, type ParseContext, type ParseResult } from "../types";
import { localWallTime, magnitudeOf, quakeCandidate, validLatLon } from "../quake-common";

export interface BmkgQuake {
  Tanggal?: string;
  Jam?: string;
  DateTime?: string;
  Coordinates?: string;
  Magnitude?: string;
  Kedalaman?: string;
  Wilayah?: string;
  Potensi?: string;
  Dirasakan?: string;
}
export interface BmkgRaw {
  latest: BmkgQuake[];
  felt: BmkgQuake[];
}

type Feed = { Infogempa?: { gempa?: BmkgQuake[] | BmkgQuake } };
const list = (f: Feed | null): BmkgQuake[] => {
  const g = f?.Infogempa?.gempa;
  return Array.isArray(g) ? g : g ? [g] : [];
};

export async function fetchBmkg(ctx: FetchContext): Promise<BmkgRaw> {
  const get = (name: string) => httpGet(`https://data.bmkg.go.id/DataMKG/TEWS/${name}`, ctx).then((r) => r.json() as Promise<Feed>);
  const [a, b] = await Promise.allSettled([get("gempaterkini.json"), get("gempadirasakan.json")]);
  if (a.status === "rejected" && b.status === "rejected") throw a.reason;
  return { latest: list(a.status === "fulfilled" ? a.value : null), felt: list(b.status === "fulfilled" ? b.value : null) };
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, mei: 5, may: 5, jun: 6, jul: 7, agu: 8, agt: 8, aug: 8, sep: 9, okt: 10, oct: 10, nov: 11, des: 12, dec: 12 };
const ZONES: Record<string, number> = { WIB: 7, WITA: 8, WIT: 9 };

/** Origin time in UTC: `DateTime` if present, else Tanggal + Jam in the stated Indonesian zone. */
export function bmkgTime(q: BmkgQuake): Date | null {
  if (q.DateTime) {
    const d = new Date(q.DateTime);
    if (!Number.isNaN(d.getTime())) return d;
  }
  const dm = /^(\d{1,2})\s+([A-Za-z]{3})\w*\s+(\d{4})$/.exec(q.Tanggal?.trim() ?? "");
  const tm = /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(WIB|WITA|WIT)$/i.exec(q.Jam?.trim() ?? "");
  const mo = dm ? MONTHS[dm[2].toLowerCase()] : undefined;
  if (!dm || !tm || !mo) return null;
  return localWallTime(Number(dm[3]), mo, Number(dm[1]), Number(tm[1]), Number(tm[2]), Number(tm[3] ?? 0), ZONES[tm[4].toUpperCase()]);
}

const DIRS: Record<string, string> = {
  timurlaut: "NE", baratlaut: "NW", tenggara: "SE", baratdaya: "SW", utara: "N", selatan: "S", timur: "E", barat: "W",
};

/** "219 km TimurLaut TARAKAN-KALTARA" / "Pusat gempa berada di laut 35 km barat daya Sumur" → "219 km NE of Tarakan-Kaltara" */
export function bmkgPlace(s: string | undefined): string | null {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  if (!t) return null;
  const m = /(\d+(?:[.,]\d+)?)\s*km\s+(timur\s?laut|barat\s?laut|barat\s?daya|tenggara|utara|selatan|timur|barat)\s+(.+)$/i.exec(t);
  if (!m) return t;
  const place = m[3].toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (_x, a: string, b: string) => a + b.toUpperCase());
  return `${m[1]} km ${DIRS[m[2].toLowerCase().replace(/\s/g, "")]} of ${place}`;
}

export function parseBmkg(raw: BmkgRaw, ctx: ParseContext): ParseResult {
  const merged = new Map<string, { latest?: BmkgQuake; felt?: BmkgQuake }>();
  let skipped = 0;
  for (const [kind, items] of [["latest", raw.latest ?? []], ["felt", raw.felt ?? []]] as const) {
    for (const q of items) {
      const t = bmkgTime(q);
      if (!t) {
        skipped++;
        continue;
      }
      const key = t.toISOString().slice(0, 19).replace(/\D/g, "");
      merged.set(key, { ...merged.get(key), [kind]: q });
    }
  }
  const candidates: EventCandidateInput[] = [];
  for (const [key, { latest, felt }] of merged) {
    const q = latest ?? felt!;
    const [lat, lon] = (q.Coordinates ?? "").split(",").map((x) => Number(x.trim()));
    if (!validLatLon(lat, lon)) {
      skipped++;
      continue;
    }
    const when = bmkgTime(q)!;
    const depth = Number.parseFloat(q.Kedalaman ?? "");
    const potensi = latest?.Potensi?.trim();
    const feltText = felt?.Dirasakan?.trim();
    const extra = [
      feltText ? `Felt (MMI): ${feltText}.` : "",
      potensi ? (/tidak berpotensi tsunami/i.test(potensi) ? "BMKG: no tsunami potential." : `BMKG: ${potensi}.`) : "",
    ].filter(Boolean).join(" ");
    candidates.push(
      quakeCandidate({
        dataSourceId: "bmkg",
        externalId: key,
        sourceName: "BMKG — Indonesian Agency for Meteorology, Climatology and Geophysics",
        agency: "BMKG",
        sourceUrl: feltText && !latest ? "https://www.bmkg.go.id/gempabumi/gempabumi-dirasakan" : "https://www.bmkg.go.id/gempabumi/gempabumi-terkini",
        credibilityBasis: "Indonesian national meteorology, climatology and geophysics agency",
        assertion: "OFFICIAL_PRELIMINARY",
        when,
        retrievedAt: ctx.retrievedAt,
        latitude: lat,
        longitude: lon,
        magnitude: magnitudeOf(q.Magnitude),
        depthKm: Number.isFinite(depth) ? depth : null,
        place: bmkgPlace(latest?.Wilayah ?? felt?.Wilayah),
        extraSummary: extra || undefined,
        extraMetrics: { felt_mmi: feltText ?? null, tsunami_potential: potensi ?? null },
        rawData: { latest, felt },
      }),
    );
  }
  return { candidates, skipped };
}

export const bmkgConnector: DataSourceConnector<BmkgRaw> = {
  id: "bmkg",
  name: "BMKG earthquakes (Indonesia)",
  description: "Indonesia's latest M5+ earthquakes (with BMKG's tsunami-potential statement) and latest felt earthquakes (with felt intensities), from BMKG.",
  homepage: "https://www.bmkg.go.id/gempabumi/gempabumi-terkini",
  attribution: "BMKG (Badan Meteorologi, Klimatologi, dan Geofisika) open data — attribution required",
  sourceType: "OFFICIAL_AGENCY",
  categories: ["EARTHQUAKE"],
  refreshIntervalMs: 5 * 60_000,
  mode: "live",
  fetch: fetchBmkg,
  parse: parseBmkg,
};
