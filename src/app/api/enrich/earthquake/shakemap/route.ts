import { badRequest, handler, json } from "@/lib/server/http";
import { isUsgsEventId } from "@/lib/enrich/usgs";
import { shakemapContours, UpstreamError } from "@/lib/enrich/server";

/**
 * GET /api/enrich/earthquake/shakemap?id=<USGS event id> — the ShakeMap
 * intensity (MMI) contour lines as GeoJSON for the globe overlay. The product
 * URL is resolved from USGS's own event detail, never taken from the client.
 * Cached 30 min.
 */
export const GET = handler(async (req: Request) => {
  const id = new URL(req.url).searchParams.get("id");
  if (!isUsgsEventId(id)) return badRequest("id must be a USGS event id such as us7000abcd");
  try {
    return json(await shakemapContours(id), { headers: { "Cache-Control": "private, max-age=900" } });
  } catch (e) {
    if (e instanceof UpstreamError) {
      const missing = e.status === 404;
      return json({ error: missing ? "No ShakeMap for this event" : "USGS is unavailable right now" }, { status: missing ? 404 : 502 });
    }
    throw e;
  }
});
