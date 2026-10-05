import { toEventSummary } from "@/types/events";
import { getRepository } from "@/lib/server/context";
import { marketMovers } from "@/lib/finance/exposure";
import { handler, json } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** GET /api/markets/movers — events from the last 24 h with rule-based market exposure. */
export const GET = handler(async () => {
  const repo = await getRepository();
  const events = await repo.scan({ from: new Date(Date.now() - 86_400_000).toISOString(), synthetic: "exclude" });
  const movers = marketMovers(events).map((m) => ({ event: toEventSummary(events.find((e) => e.id === m.event.id)!), exposure: m.exposure }));
  return json({ movers, note: "Rule-based exposure (see docs/FINANCE.md) — not a forecast or a trading signal." });
});
