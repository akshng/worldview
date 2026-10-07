import type { AisStreamMessage, DigitrafficLocations, DigitrafficVessel, VesselRow } from "./types";

/** Returns a vessel row for a position report, or null for anything else/invalid. */
export function parseAisMessage(msg: AisStreamMessage): VesselRow | null {
  if (msg?.MessageType !== "PositionReport") return null;
  const m = msg.MetaData, p = msg.Message?.PositionReport;
  if (!m || !p) return null;
  const { latitude: lat, longitude: lon } = m;
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const t = Date.parse(m.time_utc.replace(" +0000 UTC", "Z").replace(" ", "T"));
  return [
    m.MMSI,
    (m.ShipName ?? "").trim(),
    Math.round(lon * 1e4) / 1e4,
    Math.round(lat * 1e4) / 1e4,
    p.Sog >= 102.3 ? null : p.Sog, // 102.3 = not available
    p.Cog >= 360 ? null : p.Cog,
    p.TrueHeading === 511 ? null : p.TrueHeading, // 511 = not available
    p.NavigationalStatus ?? null,
    Number.isFinite(t) ? t : Date.now(),
    null,
    null,
  ];
}

const fin = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/**
 * Join Digitraffic latest positions with vessel metadata (name, type,
 * destination) into vessel rows, dropping positions older than `maxAgeMs`.
 * AIS "not available" sentinels (SOG 102.3, COG 360, heading 511) become null.
 */
export function parseDigitraffic(loc: DigitrafficLocations, vessels: DigitrafficVessel[] = [], maxAgeMs = 60 * 60_000, now = Date.now()): VesselRow[] {
  const meta = new Map<number, DigitrafficVessel>();
  for (const v of vessels) if (fin(v?.mmsi)) meta.set(v.mmsi, v);
  const out: VesselRow[] = [];
  for (const f of loc?.features ?? []) {
    const p = f?.properties ?? {};
    const mmsi = fin(p.mmsi) ? p.mmsi : f?.mmsi;
    const c = f?.geometry?.coordinates;
    if (!fin(mmsi) || !Array.isArray(c)) continue;
    const [lon, lat] = c;
    if (!fin(lon) || !fin(lat) || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    const t = fin(p.timestampExternal) ? p.timestampExternal : now;
    if (now - t > maxAgeMs) continue;
    const m = meta.get(mmsi);
    const dest = (m?.destination ?? "").trim();
    out.push([
      mmsi,
      (m?.name ?? "").trim(),
      Math.round(lon * 1e4) / 1e4,
      Math.round(lat * 1e4) / 1e4,
      fin(p.sog) && p.sog < 102.3 ? p.sog : null,
      fin(p.cog) && p.cog < 360 ? p.cog : null,
      fin(p.heading) && p.heading < 360 ? p.heading : null,
      fin(p.navStat) ? p.navStat : null,
      t,
      fin(m?.shipType) && m.shipType > 0 && m.shipType < 100 ? m.shipType : null,
      dest || null,
    ]);
  }
  return out;
}

export type ShipCategory = "cargo" | "tanker" | "passenger" | "fishing" | "service" | "pleasure" | "military" | "other";

/** Broad category for an AIS ship-type code (ITU-R M.1371, "type of ship and cargo"). */
export function shipCategory(code: number | null | undefined): ShipCategory {
  if (code == null) return "other";
  if (code >= 70 && code <= 79) return "cargo";
  if (code >= 80 && code <= 89) return "tanker";
  if (code >= 60 && code <= 69) return "passenger";
  if (code === 30) return "fishing";
  if (code === 35) return "military";
  if (code === 36 || code === 37) return "pleasure";
  if ((code >= 31 && code <= 34) || (code >= 40 && code <= 59)) return "service";
  return "other";
}

/** Map colour per ship category (also used by the legend). */
export const SHIP_COLORS: Record<ShipCategory, string> = {
  cargo: "#51cf66",
  tanker: "#ff6b6b",
  passenger: "#4dabf7",
  fishing: "#ffa94d",
  service: "#e599f7",
  pleasure: "#ffe066",
  military: "#adb5bd",
  other: "#8aa0b4",
};

const NAV_STATUS = [
  "under way (engine)",
  "at anchor",
  "not under command",
  "restricted manoeuvrability",
  "constrained by draught",
  "moored",
  "aground",
  "fishing",
  "under way (sail)",
];
export const navStatusLabel = (n: number | null | undefined) => (n != null && NAV_STATUS[n]) || null;
