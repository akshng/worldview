import { dataMode, getRepository, getSourceHealth } from "@/lib/server/context";
import { handler, json } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** GET /api/sources — data source health + recent ingestion runs (developer panel). */
export const GET = handler(async () => {
  const repo = await getRepository();
  const [sources, runs] = await Promise.all([getSourceHealth(), repo.listRuns({ limit: 40 })]);
  return json({ mode: dataMode(), repository: repo.kind, eventCount: await repo.count(), sources, runs });
});
