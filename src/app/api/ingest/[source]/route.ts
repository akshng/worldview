import { env } from "@/lib/env";
import { getRepository, runConnector } from "@/lib/server/context";
import { getConnector } from "@/data-sources/registry";
import { handler, json, notFound } from "@/lib/server/http";

export const dynamic = "force-dynamic";

function authorised(req: Request): boolean {
  const token = env().ADMIN_TOKEN;
  if (token) return req.headers.get("authorization") === `Bearer ${token}`;
  // Without a token, only allow requests addressed to a loopback host.
  const host = new URL(req.url).hostname;
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1";
}

/** POST /api/ingest/:source — trigger an immediate ingestion run. */
export const POST = handler(async (req: Request, ctx: RouteContext<"/api/ingest/[source]">) => {
  if (!authorised(req)) return json({ error: "Forbidden" }, { status: 403 });
  const { source } = await ctx.params;
  if (!getConnector(source)) return notFound(`Unknown data source "${source}"`);
  await getRepository();
  const run = await runConnector(source);
  return json({ run }, { status: run.success ? 200 : 502 });
});
