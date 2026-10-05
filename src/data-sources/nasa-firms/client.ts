import { httpGet, type FetchContext } from "../types";
import type { FirmsDetection, FirmsRaw } from "./types";

const PRODUCT = "VIIRS_SNPP_NRT";
/** Public 24 h global file — no key required. */
const PUBLIC_24H = "https://firms.modaps.eosdis.nasa.gov/data/active_fire/suomi-npp-viirs-c2/csv/SUOMI_VIIRS_C2_Global_24h.csv";
/** Area API — requires a free MAP_KEY. Day range 1 = last 24 h. */
const apiUrl = (key: string) => `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${encodeURIComponent(key)}/${PRODUCT}/world/1`;

const CONF: Record<string, FirmsDetection["confidence"]> = { l: "low", n: "nominal", h: "high", low: "low", nominal: "nominal", high: "high" };

export function parseFirmsCsv(text: string): FirmsDetection[] {
  const lines = text.split("\n");
  const header = lines[0]?.trim().split(",") ?? [];
  const idx = (k: string) => header.indexOf(k);
  const iLat = idx("latitude"), iLon = idx("longitude"), iFrp = idx("frp"), iConf = idx("confidence");
  const iDate = idx("acq_date"), iTime = idx("acq_time"), iSat = idx("satellite"), iDn = idx("daynight");
  if (iLat < 0 || iLon < 0 || iDate < 0) throw new Error("Unexpected FIRMS CSV header");
  const out: FirmsDetection[] = [];
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split(",");
    if (c.length < header.length) continue;
    const lat = Number(c[iLat]), lon = Number(c[iLon]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const t = c[iTime].padStart(4, "0");
    const acquiredAt = Date.parse(`${c[iDate]}T${t.slice(0, 2)}:${t.slice(2, 4)}:00Z`);
    out.push({
      lat,
      lon,
      frp: Number(c[iFrp]) || 0,
      confidence: CONF[c[iConf]?.trim().toLowerCase()] ?? "nominal",
      acquiredAt,
      satellite: c[iSat] ?? "",
      daynight: c[iDn]?.trim() === "D" ? "D" : "N",
    });
  }
  return out;
}

export async function fetchFirms(ctx: FetchContext): Promise<FirmsRaw> {
  const key = ctx.env.NASA_FIRMS_MAP_KEY;
  const url = key ? apiUrl(key) : PUBLIC_24H;
  const text = await (await httpGet(url, ctx, { accept: "text/csv" })).text();
  if (/invalid|error/i.test(text.slice(0, 200)) && !text.startsWith("latitude")) {
    throw new Error(`FIRMS returned an error: ${text.slice(0, 120)}`);
  }
  return { product: PRODUCT, via: key ? "api" : "public-file", detections: parseFirmsCsv(text) };
}
