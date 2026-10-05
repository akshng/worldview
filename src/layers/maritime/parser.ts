import type { AisStreamMessage, VesselRow } from "./types";

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
  ];
}
