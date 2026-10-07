import { getChokepointMonitor } from "@/lib/infra/monitor";
import { handler, json } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** GET /api/infra/chokepoints?days=7 — recent events near each maritime chokepoint plus a disruption score (1–30 days, default 7). */
export const GET = handler(async (req: Request) => {
  const d = Number(new URL(req.url).searchParams.get("days") ?? 7);
  const days = Number.isFinite(d) ? Math.min(30, Math.max(1, Math.round(d))) : 7;
  return json(await getChokepointMonitor(days));
});
