import { getEconomicCalendar } from "@/lib/finance/calendar";
import { handler, json } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** GET /api/markets/calendar?days=14 — scheduled US economic releases & Treasury auctions. */
export const GET = handler(async (req: Request) => {
  const days = Math.min(60, Math.max(1, Number(new URL(req.url).searchParams.get("days") ?? 14) || 14));
  const now = Date.now();
  const items = (await getEconomicCalendar()).filter((i) => {
    const t = Date.parse(i.at);
    return t >= now - 3 * 86_400_000 && t <= now + days * 86_400_000;
  });
  return json({ items, sources: ["BLS release schedule", "BEA release dates", "U.S. Treasury Fiscal Data — upcoming auctions"] });
});
