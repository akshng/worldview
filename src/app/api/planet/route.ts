import { getPlanetDashboard } from "@/lib/planet";
import { handler, json } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** GET /api/planet — climate and space-weather indicators (NOAA, NSIDC). Cached 3 h. */
export const GET = handler(async () => json(await getPlanetDashboard()));
