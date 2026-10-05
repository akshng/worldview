import type { AircraftRow, AviationData, OpenSkyResponse } from "./types";

const r1 = (n: number | null) => (n === null || !Number.isFinite(n) ? null : Math.round(n * 10) / 10);

export function parseOpenSky(res: OpenSkyResponse, maxAgeS = 120): AviationData {
  const rows: AircraftRow[] = [];
  for (const s of res.states ?? []) {
    const [icao, callsign, country, tPos, , lon, lat, baro, onGround, vel, track, , , geo, squawk] = s;
    if (lon === null || lat === null || !Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    // Drop stale positions so the map reflects "now".
    if (tPos !== null && res.time - tPos > maxAgeS) continue;
    rows.push([
      icao,
      (callsign ?? "").trim(),
      country,
      Math.round(lon * 1e4) / 1e4,
      Math.round(lat * 1e4) / 1e4,
      r1(geo ?? baro),
      r1(vel),
      r1(track),
      onGround,
      squawk,
    ]);
  }
  return { fields: ["icao24", "callsign", "country", "lon", "lat", "altitude_m", "speed_ms", "track_deg", "on_ground", "squawk"], rows };
}
