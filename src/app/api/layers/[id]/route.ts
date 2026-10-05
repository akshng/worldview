import { getLayer, LayerError } from "@/layers/registry";
import { handler, json } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** GET /api/layers/:id — cached snapshot of a live layer (aviation, maritime, weather-radar). */
export const GET = handler(async (_req: Request, ctx: RouteContext<"/api/layers/[id]">) => {
  const { id } = await ctx.params;
  try {
    const { snapshot, stale } = await getLayer(id);
    return json({ ...snapshot, stale });
  } catch (err) {
    if (err instanceof LayerError) return json({ error: err.message }, { status: err.status });
    throw err;
  }
});
