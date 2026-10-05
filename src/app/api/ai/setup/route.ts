import { getLocalProvider } from "@/lib/ai";
import { handler, json } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/**
 * POST /api/ai/setup — start downloading/loading the local model in the
 * background. Progress is reported by GET /api/meta → ai.local.
 */
export const POST = handler(async (req: Request) => {
  const host = new URL(req.url).hostname;
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(host)) return json({ error: "Forbidden" }, { status: 403 });
  const local = getLocalProvider();
  if (!local) return json({ error: "The local AI provider is not active (AI_PROVIDER is not 'local')." }, { status: 409 });
  void local.ensureReady().catch(() => {});
  return json({ started: true, status: local.status() });
});
