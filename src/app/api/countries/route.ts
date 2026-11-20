import { COUNTRIES } from "@/lib/geo/gazetteer";
import { handler, json } from "@/lib/server/http";
import { dedupeByCode } from "@/lib/countries-rank";

/**
 * GET /api/countries — every country (code, name, continent, population), small enough for a list.
 * One entry per ISO2 code: territories sharing their sovereign's code are merged into it.
 */
export const GET = handler(async () =>
  json(
    { countries: dedupeByCode(COUNTRIES).map((c) => ({ code: c.code, name: c.name, continent: c.continent, subregion: c.subregion, population: c.population })).sort((a, b) => a.name.localeCompare(b.name)) },
    { headers: { "Cache-Control": "public, max-age=86400" } },
  ),
);
