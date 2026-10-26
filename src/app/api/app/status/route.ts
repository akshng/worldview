import { getMarketSnapshot, getQuote } from "@/lib/finance/service";
import { getRepository } from "@/lib/server/context";
import { loadWatchlist } from "@/lib/server/watchlist";
import { handler, json } from "@/lib/server/http";

export const dynamic = "force-dynamic";

const KEY: Record<string, string> = { "^GSPC": "S&P 500", "^IXIC": "Nasdaq", "^VIX": "VIX", DGS10: "10Y", "CL=F": "Oil", "GC=F": "Gold", "BTC-USD": "Bitcoin" };

/**
 * GET /api/app/status — one small payload for the Mac app's menu bar and Dock
 * badge: key quotes (from the cached snapshot), the watchlist and recent major events.
 */
export const GET = handler(async (req: Request) => {
  const since = new URL(req.url).searchParams.get("since");
  const repo = await getRepository();
  const [snap, watch, events] = await Promise.all([
    getMarketSnapshot(),
    loadWatchlist(),
    repo.scan({ from: new Date(Date.now() - 6 * 3_600_000).toISOString(), synthetic: "exclude" }),
  ]);
  const all = Object.values(snap.groups).flat();
  const q = (sym: string, name?: string) => {
    const x = all.find((i) => i.symbol === sym);
    return x ? { symbol: sym, name: name ?? x.name, price: x.price, changePct: x.changePct, unit: x.unit } : null;
  };
  const major = events
    .filter((e) => e.importanceScore >= 70 && e.status !== "RESOLVED")
    .sort((a, b) => b.importanceScore - a.importanceScore)
    .slice(0, 8)
    .map((e) => ({ id: e.id, title: e.title, importance: Math.round(e.importanceScore), timestamp: e.timestamp, createdAt: e.createdAt }));
  const sinceMs = since ? Date.parse(since) : NaN;
  return json({
    quotes: Object.entries(KEY).flatMap(([s, n]) => q(s, n) ?? []),
    watchlist: await Promise.all(
      watch.slice(0, 12).map(async (s) => q(s) ?? (await getQuote(s, "watchlist").then((x) => ({ symbol: s, name: x.name, price: x.price, changePct: x.changePct, unit: x.unit })).catch(() => ({ symbol: s, name: s, price: null, changePct: null, unit: "price" as const })))),
    ),
    major,
    newMajor: Number.isFinite(sinceMs) ? major.filter((e) => Date.parse(e.createdAt) > sinceMs).length : 0,
    generatedAt: new Date().toISOString(),
  });
});
