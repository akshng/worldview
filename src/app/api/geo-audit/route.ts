import { auditGeography } from "@/lib/geo/audit";
import { getRepository } from "@/lib/server/context";
import { handler, json } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** GET /api/geo-audit — developer QA of event coordinates vs. claimed countries. */
export const GET = handler(async () => {
  const repo = await getRepository();
  return json(auditGeography(await repo.scan({})));
});
