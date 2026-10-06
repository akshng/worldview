import { getPredictionMarkets } from "@/lib/finance/prediction-markets";
import { handler, json } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** GET /api/markets/predictions — prediction-market implied probabilities (Kalshi; sports excluded). */
export const GET = handler(async () => {
  try {
    return json(await getPredictionMarkets());
  } catch (err) {
    // Upstream unreachable and nothing cached yet: say so plainly instead of a 500.
    console.warn("[predictions]", err instanceof Error ? err.message : err);
    return json({ error: "Kalshi isn't reachable right now — try again in a few minutes." }, { status: 503 });
  }
});
