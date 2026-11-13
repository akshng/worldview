import { z } from "zod";
import { AlertRulesSchema, MAX_RULES } from "@/lib/notify/rules";
import { loadRules, saveRules } from "@/lib/notify/rules-server";
import { discordWebhook } from "@/lib/notify/discord";
import { badRequest, handler, isAdminRequest, json } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** GET /api/alert-rules — the user's alert rules, and whether Discord is configured (never the URL). */
export const GET = handler(async () => json({ rules: await loadRules(), discord: !!discordWebhook(), max: MAX_RULES }));

const Body = z.object({ rules: AlertRulesSchema });

/** POST /api/alert-rules — replace the whole rule set (local only). */
export const POST = handler(async (req: Request) => {
  if (!isAdminRequest(req)) return json({ error: "Forbidden" }, { status: 403 });
  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success) return badRequest(body.error);
  return json({ rules: await saveRules(body.data.rules), discord: !!discordWebhook(), max: MAX_RULES });
});
