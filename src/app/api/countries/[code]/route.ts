import { getRepository } from "@/lib/server/context";
import { countryOverview } from "@/lib/server/analytics";
import { badRequest, handler, json } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** GET /api/countries/:code — ISO 3166-1 alpha-2 (or alpha-3) country overview. */
export const GET = handler(async (_req: Request, ctx: RouteContext<"/api/countries/[code]">) => {
  const { code } = await ctx.params;
  if (!/^([A-Za-z]{2,3}|X-[A-Za-z0-9]{3})$/.test(code)) return badRequest("Invalid country code");
  const repo = await getRepository();
  return json(await countryOverview(repo, code));
});
