import { backtestSetups, liveScorecard } from "@/lib/finance/setups-score-service";
import { handler, json } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** GET /api/markets/setups/scorecard — how posted setups did vs the S&P 500, plus a backtest of the rules. Not advice. */
export const GET = handler(async () => {
  const [live, bt] = await Promise.all([liveScorecard(), backtestSetups()]);
  return json({ live, backtest: bt });
});
