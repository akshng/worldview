import { getLocalProvider } from "@/lib/ai";
import { handler, isAdminRequest, json } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** POST /api/ai/unload — free the on-device model now (admin). It reloads on the next AI request. */
export const POST = handler(async (req: Request) => {
  if (!isAdminRequest(req)) return json({ error: "Forbidden" }, { status: 403 });
  const local = getLocalProvider();
  if (!local) return json({ unloaded: false, reason: "Local AI is not active" });
  return json({ unloaded: await local.unload(), status: local.status() });
});
