import { COUNTRIES } from "@/lib/geo/gazetteer";
import { handler, json } from "@/lib/server/http";

/** GET /api/countries — every country (code, name, continent, population), small enough for a list. */
export const GET = handler(async () =>
  json(
    { countries: COUNTRIES.map((c) => ({ code: c.code, name: c.name, continent: c.continent, subregion: c.subregion, population: c.population })).sort((a, b) => a.name.localeCompare(b.name)) },
    { headers: { "Cache-Control": "public, max-age=86400" } },
  ),
);
