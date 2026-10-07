import { getLayerBody, LayerError } from "@/layers/registry";
import { handler, json } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/**
 * GET /api/layers/:id — cached snapshot of a live layer (aviation, maritime, weather-radar, cameras …).
 * The body is serialised and gzipped once per snapshot; clients that send the ETag get a 304.
 */
export const GET = handler(async (req: Request, ctx: RouteContext<"/api/layers/[id]">) => {
  const { id } = await ctx.params;
  try {
    const body = await getLayerBody(id);
    const headers: Record<string, string> = { "Content-Type": "application/json", "Cache-Control": "no-cache", ETag: body.etag, Vary: "Accept-Encoding" };
    if (req.headers.get("if-none-match") === body.etag) return new Response(null, { status: 304, headers });
    const gz = /\bgzip\b/.test(req.headers.get("accept-encoding") ?? "");
    if (gz) headers["Content-Encoding"] = "gzip";
    return new Response(new Uint8Array(gz ? body.gzip : body.json), { status: 200, headers });
  } catch (err) {
    if (err instanceof LayerError) return json({ error: err.message }, { status: err.status });
    throw err;
  }
});
