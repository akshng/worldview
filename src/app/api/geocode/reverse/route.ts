import { z } from "zod";
import { describeNearest, reverseGeocode } from "@/lib/geo/gazetteer";
import { badRequest, handler, json } from "@/lib/server/http";

const Query = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lon: z.coerce.number().min(-180).max(180),
});

/**
 * GET /api/geocode/reverse?lat=&lon= — offline point → "near <city>, <country>"
 * from the bundled Natural Earth gazetteer (no external service). Used by the
 * globe's street-level "drop in" view.
 */
export const GET = handler(async (req: Request) => {
  const sp = new URL(req.url).searchParams;
  const parsed = Query.safeParse({ lat: sp.get("lat"), lon: sp.get("lon") });
  if (!parsed.success) return badRequest(parsed.error);
  const { lat, lon } = parsed.data;
  const { country } = reverseGeocode(lat, lon);
  return json(
    { near: describeNearest(lat, lon, 400), country: country?.name ?? null, countryCode: country?.code ?? null },
    { headers: { "Cache-Control": "public, max-age=86400" } },
  );
});
