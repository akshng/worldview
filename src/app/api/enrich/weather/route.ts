import { badRequest, handler, json } from "@/lib/server/http";
import { parseLatLon } from "@/lib/enrich/weather";
import { pointWeather, UpstreamError } from "@/lib/enrich/server";

/**
 * GET /api/enrich/weather?lat=&lon=[&marine=1][&flood=1] — current conditions and
 * the next 24 h at a point from Open-Meteo (keyless; "Weather data by
 * Open-Meteo.com"). Coordinates are snapped to a 0.05° grid and cached 20 min.
 * Near sea level (or with marine=1) it adds sea state from the Marine API;
 * flood=1 adds modelled river discharge from the Flood API.
 */
export const GET = handler(async (req: Request) => {
  const sp = new URL(req.url).searchParams;
  const p = parseLatLon(sp.get("lat"), sp.get("lon"));
  if (!p) return badRequest("lat must be -90…90 and lon -180…180");
  try {
    const data = await pointWeather(p.lat, p.lon, { marine: sp.get("marine") === "1", flood: sp.get("flood") === "1" });
    return json(data, { headers: { "Cache-Control": "private, max-age=600" } });
  } catch (e) {
    if (e instanceof UpstreamError) return json({ error: "Weather is unavailable right now" }, { status: e.status === 404 ? 404 : 502 });
    throw e;
  }
});
