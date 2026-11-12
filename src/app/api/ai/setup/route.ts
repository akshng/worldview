import { getLocalProvider } from "@/lib/ai";
import { handler, isAdminRequest, json } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/**
 * POST /api/ai/setup — start downloading/loading the local model in the
 * background. Progress is reported by GET /api/meta → ai.local.
 */
export const POST = handler(async (req: Request) => {
  if (!isAdminRequest(req)) return json({ error: "Forbidden" }, { status: 403 });
  const local = getLocalProvider();
  if (!local) return json({ error: "The local AI provider is not active (AI_PROVIDER is not 'local')." }, { status: 409 });
  void local.ensureReady().catch(() => {});
  return json({ started: true, status: local.status() });
});
