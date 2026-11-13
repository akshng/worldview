import { badRequest, handler, json } from "@/lib/server/http";
import { isUsgsEventId } from "@/lib/enrich/usgs";
import { earthquakeContext, UpstreamError } from "@/lib/enrich/server";

/**
 * GET /api/enrich/earthquake?id=<USGS event id> — ShakeMap, PAGER and DYFI
 * ("Did You Feel It?") products for a USGS earthquake, from the USGS event
 * detail feed. Cached 10 min. `{ context: null }` when USGS has none.
 */
export const GET = handler(async (req: Request) => {
  const id = new URL(req.url).searchParams.get("id");
  if (!isUsgsEventId(id)) return badRequest("id must be a USGS event id such as us7000abcd");
  try {
    const context = await earthquakeContext(id);
    return json({ context }, { headers: { "Cache-Control": "private, max-age=300" } });
  } catch (e) {
    if (e instanceof UpstreamError) {
      if (e.status === 404) return json({ context: null });
      return json({ error: "USGS is unavailable right now" }, { status: 502 });
    }
    throw e;
  }
});
