import { getCryptoMarkets } from "@/lib/finance/crypto";
import { handler, json } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** GET /api/markets/crypto — top 20 cryptocurrencies by market cap (CoinGecko, cached 5 min). */
export const GET = handler(async () => json(await getCryptoMarkets()));
