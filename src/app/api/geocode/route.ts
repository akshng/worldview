import { z } from "zod";
import { geocode, RateLimitError } from "@/lib/geo/geocode";
import { badRequest, handler, json } from "@/lib/server/http";

export const dynamic = "force-dynamic";

const Query = z.object({ q: z.string().trim().min(1).max(200) });

/**
 * GET /api/geocode?q= — online place search (addresses, landmarks, small
 * towns) via Photon by komoot. Cached 24 h per query, rate-limited.
 * Search by Photon (komoot), data © OpenStreetMap contributors.
 */
export const GET = handler(async (req: Request) => {
  const parsed = Query.safeParse({ q: new URL(req.url).searchParams.get("q") ?? "" });
  if (!parsed.success) return badRequest(parsed.error);
  const client = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";
  try {
    return json(await geocode(parsed.data.q, client));
  } catch (err) {
    if (err instanceof RateLimitError) {
      return json({ error: err.message }, { status: 429, headers: { "Retry-After": String(err.retryAfterSec) } });
    }
    console.warn("[geocode] Photon request failed:", err);
    return json({ error: "Geocoding service unavailable" }, { status: 502 });
  }
});
