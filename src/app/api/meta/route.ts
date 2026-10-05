import { dataMode, getRepository } from "@/lib/server/context";
import { aiStatus } from "@/lib/ai";
import { handler, json } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** GET /api/meta — non-secret runtime info for the client (mode, AI availability). */
export const GET = handler(async () => {
  const repo = await getRepository();
  return json({ mode: dataMode(), ai: aiStatus(), repository: repo.kind, version: repo.version() });
});
