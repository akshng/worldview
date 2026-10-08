/**
 * adsb.lol /v2/mil response → rows. Shares the readsb parsing with the civil
 * aircraft layer (src/layers/aircraft/parser.ts).
 */
import { parseAdsbLol, type AdsbLolResponse } from "@/layers/aircraft/parser";

export type { AdsbLolAircraft, AdsbLolResponse } from "@/layers/aircraft/parser";

/** [hex, callsign, registration, typeCode, lon, lat, altFt (null = n/a), onGround, groundSpeedKt, trackDeg, squawk, positionAgeSec] */
export type MilRow = [string, string, string, string, number, number, number | null, boolean, number | null, number | null, string, number];

export interface MilitaryAircraftData {
  fields: string[];
  rows: MilRow[];
}

/** Aircraft with a usable position, at most `maxAgeSec` old. */
export function parseAdsbLolMil(raw: AdsbLolResponse, maxAgeSec = 120): MilRow[] {
  return parseAdsbLol(raw, maxAgeSec).map((r) => r.slice(0, 12) as MilRow);
}
