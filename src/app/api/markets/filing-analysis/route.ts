import { z } from "zod";
import { ACCESSION_RE, filingAnalysisStatus, startFilingAnalysis } from "@/lib/finance/filing-analysis";
import { badRequest, handler, json } from "@/lib/server/http";

export const dynamic = "force-dynamic";

const Body = z.object({
  ticker: z.string().trim().min(1).max(12).regex(/^[A-Za-z0-9.\-]+$/),
  accession: z.string().regex(ACCESSION_RE),
});

/** GET /api/markets/filing-analysis?accession=… — cached result or the running job's progress. */
export const GET = handler(async (req: Request) => {
  const accession = new URL(req.url).searchParams.get("accession") ?? "";
  if (!ACCESSION_RE.test(accession)) return badRequest("accession must look like 0000320193-25-000079");
  return json(await filingAnalysisStatus(accession));
});

/** POST /api/markets/filing-analysis {ticker, accession} — start (or join) the analysis of a 10-K. */
export const POST = handler(async (req: Request) => {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest(parsed.error);
  return json(await startFilingAnalysis(parsed.data.ticker, parsed.data.accession), { status: 202 });
});
