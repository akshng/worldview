import { getTrends } from "@/lib/trends";
import { badRequest, handler, json } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/**
 * GET /api/trends — trending searches and topics (Google Trends, Wikipedia, Bluesky,
 * Mastodon, Hacker News). Cached 15 min. `?geo=XX` returns only that country's Google
 * trending searches (null when the country isn't covered).
 */
export const GET = handler(async (req: Request) => {
  const geo = new URL(req.url).searchParams.get("geo");
  const trends = await getTrends();
  if (geo === null) return json(trends);
  if (!/^[A-Za-z]{2}$/.test(geo)) return badRequest("geo must be an ISO 3166-1 alpha-2 code");
  const code = geo.toUpperCase();
  return json({ geo: code, country: trends.google.find((c) => c.geo === code) ?? null, generatedAt: trends.generatedAt });
});
