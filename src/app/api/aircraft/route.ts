import { viewportAircraft } from "@/layers/aircraft";
import { badRequest, handler, json } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/**
 * GET /api/aircraft?bbox=west,south,east,north — live aircraft in the map view
 * (adsb.lol, cached per 6° cell for ~12 s and shared between clients).
 */
export const GET = handler(async (req: Request) => {
  const raw = new URL(req.url).searchParams.get("bbox") ?? "";
  const bbox = raw.split(",").map(Number);
  if (bbox.length !== 4 || !bbox.every(Number.isFinite) || Math.abs(bbox[1]) > 90 || Math.abs(bbox[3]) > 90 || bbox[3] <= bbox[1]) {
    return badRequest("bbox must be west,south,east,north in degrees");
  }
  try {
    return json(await viewportAircraft(bbox as [number, number, number, number]));
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "Aircraft unavailable" }, { status: 502 });
  }
});
