import { z } from "zod";
import { AlertRuleSchema } from "@/lib/notify/rules";
import { testRule } from "@/lib/notify/rules-server";
import { getRepository } from "@/lib/server/context";
import { badRequest, handler, isAdminRequest, json } from "@/lib/server/http";

export const dynamic = "force-dynamic";

const Body = z.object({ rule: AlertRuleSchema });

/** POST /api/alert-rules/test — how many of the last 24 h's events a rule matches. Never posts to Discord. */
export const POST = handler(async (req: Request) => {
  if (!isAdminRequest(req)) return json({ error: "Forbidden" }, { status: 403 });
  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success) return badRequest(body.error);
  return json(await testRule(await getRepository(), body.data.rule));
});
