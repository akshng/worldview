import { getRepository, runConnector } from "@/lib/server/context";
import { getConnector } from "@/data-sources/registry";
import { handler, isAdminRequest, json, notFound } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** POST /api/ingest/:source — trigger an immediate ingestion run. */
export const POST = handler(async (req: Request, ctx: RouteContext<"/api/ingest/[source]">) => {
  if (!isAdminRequest(req)) return json({ error: "Forbidden" }, { status: 403 });
  const { source } = await ctx.params;
  if (!getConnector(source)) return notFound(`Unknown data source "${source}"`);
  await getRepository();
  const run = await runConnector(source);
  return json({ run }, { status: run.success ? 200 : 502 });
});
