import type { AisStreamMessage, DigitrafficLocations, DigitrafficVessel, VesselRow, VesselStatic } from "./types";
import { aisDimensions, decodeAisEta, etaFromParts } from "./mid";

const fin = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Returns a vessel row for a position report, or null for anything else/invalid. */
export function parseAisMessage(msg: AisStreamMessage): VesselRow | null {
  const p = msg?.MessageType === "PositionReport" ? msg.Message?.PositionReport : msg?.MessageType === "StandardClassBPositionReport" ? { ...msg.Message?.StandardClassBPositionReport, NavigationalStatus: undefined } : undefined;
  const m = msg?.MetaData;
  if (!m || !p) return null;
  const { latitude: lat, longitude: lon } = m;
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const t = Date.parse(m.time_utc.replace(" +0000 UTC", "Z").replace(" ", "T"));
  return [
    m.MMSI,
    (m.ShipName ?? "").trim(),
    Math.round(lon * 1e4) / 1e4,
    Math.round(lat * 1e4) / 1e4,
    fin(p.Sog) && p.Sog < 102.3 ? p.Sog : null, // 102.3 = not available
    fin(p.Cog) && p.Cog < 360 ? p.Cog : null,
    fin(p.TrueHeading) && p.TrueHeading < 360 ? p.TrueHeading : null, // 511 = not available
    fin(p.NavigationalStatus) ? p.NavigationalStatus : null,
    Number.isFinite(t) ? t : Date.now(),
    null,
    null,
  ];
}

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

/** Static/voyage data from an AISStream ShipStaticData message, or null. */
export function parseAisStatic(msg: AisStreamMessage, now = Date.now()): { mmsi: number; data: VesselStatic } | null {
  const d = msg?.MessageType === "ShipStaticData" ? msg.Message?.ShipStaticData : undefined;
  const mmsi = msg?.MetaData?.MMSI;
  if (!d || !fin(mmsi)) return null;
  const dim = aisDimensions(d.Dimension?.A, d.Dimension?.B, d.Dimension?.C, d.Dimension?.D);
  const e = d.Eta;
  return {
    mmsi,
    data: {
      name: (d.Name ?? "").trim() || undefined,
      imo: fin(d.ImoNumber) && d.ImoNumber > 0 ? d.ImoNumber : null,
      callSign: (d.CallSign ?? "").trim() || undefined,
      shipType: fin(d.Type) && d.Type > 0 && d.Type < 100 ? d.Type : null,
      destination: (d.Destination ?? "").trim() || undefined,
      eta: e ? etaFromParts(e.Month ?? 0, e.Day ?? 0, e.Hour ?? 24, e.Minute ?? 60, now) : null,
      draughtM: fin(d.MaximumStaticDraught) && d.MaximumStaticDraught > 0 ? d.MaximumStaticDraught : null,
      ...dim,
      updatedAt: now,
    },
  };
}

/** Static/voyage data from a Digitraffic /vessels record (draught in decimetres, packed ETA). */
export function digitrafficStatic(v: DigitrafficVessel, now = Date.now()): VesselStatic {
  return {
    name: (v.name ?? "").trim() || undefined,
    imo: fin(v.imo) && v.imo > 0 ? v.imo : null,
    callSign: (v.callSign ?? "").trim() || undefined,
    shipType: fin(v.shipType) && v.shipType > 0 && v.shipType < 100 ? v.shipType : null,
    destination: (v.destination ?? "").trim() || undefined,
    eta: decodeAisEta(v.eta, now),
    draughtM: fin(v.draught) && v.draught > 0 ? v.draught / 10 : null,
    ...aisDimensions(v.referencePointA, v.referencePointB, v.referencePointC, v.referencePointD),
    updatedAt: fin(v.timestamp) ? v.timestamp : undefined,
  };
}
