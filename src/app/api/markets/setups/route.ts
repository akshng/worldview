import { scanSetups } from "@/lib/finance/setups-service";
import { handler, isAdminRequest, json } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** GET /api/markets/setups — today's rule-based stock setups (no AI). Information only, not advice. */
export const GET = handler(async () => json(await scanSetups({ max: 10, minScore: 2 })));

/** POST /api/markets/setups — run the scan now, add AI notes and post to Discord (admin). */
export const POST = handler(async (req: Request) => {
  if (!isAdminRequest(req)) return json({ error: "Forbidden" }, { status: 403 });
  const { annotateSetups } = await import("@/lib/finance/setups-service");
  const { discordWebhook, sendDiscord, setupEmbeds } = await import("@/lib/notify/discord");
  const { setups } = await scanSetups({ max: 3 });
  const model = await annotateSetups(setups);
  const sent = setups.length && discordWebhook() ? await sendDiscord(`**[WorldView]** 🔎 ${setups.length === 1 ? "A stock setup" : `${setups.length} stock setups`} worth a look — rule-based screen, not advice`, setupEmbeds(setups, model)) : false;
  return json({ setups, model, sent });
});
