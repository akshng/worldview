import { z } from "zod";
import { loadWatchlist, saveWatchlist } from "@/lib/server/watchlist";
import { badRequest, handler, isAdminRequest, json } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** GET /api/watchlist — the watchlist background alerts use. */
export const GET = handler(async () => json({ symbols: await loadWatchlist() }));

const Body = z.object({ symbols: z.array(z.string().max(16)).max(50) });

/** POST /api/watchlist — the app syncs the in-browser watchlist here (local only). */
export const POST = handler(async (req: Request) => {
  if (!isAdminRequest(req)) return json({ error: "Forbidden" }, { status: 403 });
  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success) return badRequest(body.error);
  return json({ symbols: await saveWatchlist(body.data.symbols) });
});
