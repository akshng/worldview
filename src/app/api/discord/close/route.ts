import { runCloseJobs } from "@/lib/notify/discord-server";
import { handler, isAdminRequest, json } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** POST /api/discord/close — run today's after-close Discord jobs (market wrap + setups) now (admin). */
export const POST = handler(async (req: Request) => {
  if (!isAdminRequest(req)) return json({ error: "Forbidden" }, { status: 403 });
  return json({ log: await runCloseJobs() });
});
