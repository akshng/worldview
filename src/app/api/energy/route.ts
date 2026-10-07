import { getEnergy } from "@/lib/energy";
import { handler, json } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** GET /api/energy — live grid demand, generation mix, carbon intensity and prices (GB, ES, FR, DE, AU NEM). Cached 10 min. */
export const GET = handler(async () => json(await getEnergy()));
