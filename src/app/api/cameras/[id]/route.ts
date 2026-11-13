import { getLayer, LayerError } from "@/layers/registry";
import { cameraMedia, findCamera, type CamerasFull } from "@/layers/cameras";
import { userAgent } from "@/lib/env";
import { badRequest, decodeParam, handler, json, notFound } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** GET /api/cameras/:id — media URLs (still, HLS / MP4) for one camera of the cameras layer. */
export const GET = handler(async (_req: Request, ctx: RouteContext<"/api/cameras/[id]">) => {
  const { id: raw } = await ctx.params;
  const id = decodeParam(raw);
  if (id === null) return badRequest("Invalid camera id");
  try {
    const { snapshot } = await getLayer("cameras");
    const full = snapshot.data as CamerasFull;
    const row = findCamera(full, id);
    if (!row) return notFound("Unknown camera");
    const media = await cameraMedia(row, full.sources[row[4]], userAgent());
    // Volatile stills change URL every frame; others are stable for the list's lifetime.
    return json(media, { headers: { "Cache-Control": media.volatileImage ? "no-store" : "private, max-age=300" } });
  } catch (err) {
    if (err instanceof LayerError) return json({ error: err.message }, { status: err.status });
    throw err;
  }
});
