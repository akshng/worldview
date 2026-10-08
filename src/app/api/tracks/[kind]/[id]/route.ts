import { aircraftDetail } from "@/layers/aircraft";
import { vesselDetail } from "@/layers/maritime";
import type { MaritimeData, VesselRow } from "@/layers/maritime/types";
import { getLayer } from "@/layers/registry";
import { badRequest, handler, json, notFound } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/**
 * GET /api/tracks/ship/:mmsi and /api/tracks/aircraft/:hex — details for the
 * tracked-object panel (static data, flag / registration country, recent trail).
 * Served from what the live layers already hold; aircraft may refresh from adsb.lol.
 */
export const GET = handler(async (_req: Request, ctx: RouteContext<"/api/tracks/[kind]/[id]">) => {
  const { kind, id } = await ctx.params;
  if (kind === "ship") {
    const mmsi = Number(id);
    if (!/^\d{1,9}$/.test(id) || !mmsi) return badRequest("MMSI must be a number");
    let row: VesselRow | null = null;
    try {
      const { snapshot } = await getLayer("maritime");
      row = (snapshot.data as MaritimeData).rows.find((r) => r[0] === mmsi) ?? null;
    } catch {
      /* layer unavailable: stream stores may still know it */
    }
    return json(vesselDetail(mmsi, row));
  }
  if (kind === "aircraft") {
    const hex = id.toLowerCase();
    if (!/^~?[0-9a-f]{6}$/.test(hex)) return badRequest("ICAO address must be 6 hex digits");
    const d = await aircraftDetail(hex);
    return d ? json(d) : notFound("Aircraft not currently tracked");
  }
  return notFound(`Unknown track kind "${kind}"`);
});
