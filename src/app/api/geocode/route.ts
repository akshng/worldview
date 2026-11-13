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
  // One local key: the server binds to 127.0.0.1 with no proxy in front, so X-Forwarded-For
  // is whatever the caller sent and must not pick the rate-limit bucket.
  try {
    return json(await geocode(parsed.data.q, "local"));
  } catch (err) {
    if (err instanceof RateLimitError) {
      return json({ error: err.message }, { status: 429, headers: { "Retry-After": String(err.retryAfterSec) } });
    }
    console.warn("[geocode] Photon request failed:", err);
    return json({ error: "Geocoding service unavailable" }, { status: 502 });
  }
});
