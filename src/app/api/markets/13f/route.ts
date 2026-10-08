import { ContactMissingError, listManagers } from "@/lib/finance/thirteenf-service";
import { handler, json } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/**
 * GET /api/markets/13f — tracked institutional managers with their latest 13F
 * report period, total value and position count. Managers still loading are
 * returned with status "loading" (and counted in `pending`); poll to fill in.
 */
export const GET = handler(async () => {
  try {
    return json(await listManagers());
  } catch (err) {
    if (err instanceof ContactMissingError) return json({ error: err.message }, { status: 503 });
    throw err;
  }
});
