import { getSecurityDashboard } from "@/lib/cyber";
import { handler, json } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** GET /api/cyber — CISA KEV additions, new critical CVEs (NVD) and travel-advisory changes (US/UK/CA/AU). Cached 1 h. */
export const GET = handler(async () => json(await getSecurityDashboard()));
