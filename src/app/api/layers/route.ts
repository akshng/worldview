import { layerHealth } from "@/layers/registry";
import { handler, json } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** GET /api/layers — live layer availability and cache status. */
export const GET = handler(async () => json({ layers: layerHealth() }));
