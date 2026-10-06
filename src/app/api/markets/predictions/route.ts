import { getPredictionMarkets } from "@/lib/finance/prediction-markets";
import { handler, json } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** GET /api/markets/predictions — prediction-market implied probabilities (Kalshi; sports excluded). */
export const GET = handler(async () => json(await getPredictionMarkets()));
