import { viewportShips } from "@/layers/maritime/viewport";
import { badRequest, handler, json } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/**
 * GET /api/ships?bbox=west,south,east,north — vessels in the map view: the
 * keyless Baltic / Norway feeds (and AISStream.io with a key) merged with
 * Open Waters AIS cells around the view.
 */
export const GET = handler(async (req: Request) => {
  const bbox = (new URL(req.url).searchParams.get("bbox") ?? "").split(",").map(Number);
  if (bbox.length !== 4 || !bbox.every(Number.isFinite) || Math.abs(bbox[1]) > 90 || Math.abs(bbox[3]) > 90 || bbox[3] <= bbox[1]) {
    return badRequest("bbox must be west,south,east,north in degrees");
  }
  try {
    return json(await viewportShips(bbox as [number, number, number, number]));
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "Ships unavailable" }, { status: 502 });
  }
});
