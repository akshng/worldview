/**
 * Aircraft broadcasting ADS-B that the community aircraft database flags as
 * military, from adsb.lol (keyless, data under ODbL 1.0). Many military
 * aircraft do not broadcast at all, so this is never a complete picture.
 */
import type { LiveLayerProvider } from "../types";
import { parseAdsbLolMil, type AdsbLolResponse, type MilitaryAircraftData } from "./parser";
import { adsbLolGet, recordAircraft } from "@/layers/aircraft";

export type { MilitaryAircraftData, MilRow } from "./parser";

export const militaryAircraftLayer: LiveLayerProvider<MilitaryAircraftData> = {
  id: "military-aircraft",
  name: "Military aircraft (adsb.lol)",
  description: "Aircraft broadcasting ADS-B identified as military in the community database (adsb.lol /v2/mil).",
  homepage: "https://api.adsb.lol/docs",
  attribution: "adsb.lol, ODbL 1.0",
  ttlMs: 30_000,
  async load(ctx) {
    // Shares adsb.lol's per-IP rate limit with the AIR overlay, so it goes through the same throttle.
    const raw = await adsbLolGet<AdsbLolResponse>("https://api.adsb.lol/v2/mil");
    const rows = parseAdsbLolMil(raw);
    recordAircraft(raw.ac, ctx.now);
    return {
      layerId: "military-aircraft",
      observedAt: new Date(typeof raw.now === "number" ? raw.now : ctx.now).toISOString(),
      retrievedAt: new Date(ctx.now).toISOString(),
      count: rows.length,
      data: {
        fields: ["hex", "callsign", "registration", "type", "lon", "lat", "alt_ft", "on_ground", "gs_kt", "track_deg", "squawk", "position_age_s"],
        rows,
      },
      attribution: this.attribution,
      notes: [
        "Aircraft broadcasting ADS-B identified as military in the community database — most military flights do not broadcast and are absent.",
        "Volunteer receiver coverage: dense over Europe / North America, sparse elsewhere.",
      ],
    };
  },
};
