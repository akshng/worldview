import { getCountryProfile } from "@/lib/country-profile";
import { badRequest, handler, json } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/**
 * GET /api/countries/:code/profile — key stats (population, GDP, growth, inflation,
 * unemployment, debt, rates, HDI) and facts (capital, currency, leaders) from the World
 * Bank, IMF, Eurostat, OECD and Wikidata. Cached 24 h per country.
 */
export const GET = handler(async (_req: Request, ctx: RouteContext<"/api/countries/[code]/profile">) => {
  const { code } = await ctx.params;
  if (!/^[A-Za-z]{2,3}$/.test(code)) return badRequest("Invalid country code");
  return json(await getCountryProfile(code));
});
