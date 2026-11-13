import { z } from "zod";
import { getHistory } from "@/lib/finance/service";
import { HISTORY_RANGES, type HistoryRange } from "@/lib/finance/providers";
import { SYMBOL_PATTERN } from "@/lib/finance/instruments";
import { companyProfile } from "@/lib/finance/company";
import { getRepository } from "@/lib/server/context";
import { toEventSummary } from "@/types/events";
import { badRequest, decodeParam, handler, json } from "@/lib/server/http";

export const dynamic = "force-dynamic";

const Range = z.enum(Object.keys(HISTORY_RANGES) as [HistoryRange, ...HistoryRange[]]).default("1mo");

/**
 * GET /api/markets/instrument/:symbol?range=1d|5d|1mo|6mo|1y|5y
 * Price history + (for SEC registrants) company profile, filings, fundamentals,
 * and WorldView events about the company.
 */
export const GET = handler(async (req: Request, ctx: RouteContext<"/api/markets/instrument/[symbol]">) => {
  const symbol = decodeParam((await ctx.params).symbol)?.toUpperCase();
  if (!symbol || !SYMBOL_PATTERN.test(symbol)) return badRequest("Invalid symbol");
  const range = Range.safeParse(new URL(req.url).searchParams.get("range") ?? undefined);
  if (!range.success) return badRequest(range.error);

  const isEquityLike = /^[A-Z][A-Z.\-]{0,6}$/.test(symbol);
  const [history, company] = await Promise.all([
    getHistory(symbol, range.data).catch((e) => ({ error: e instanceof Error ? e.message : String(e) })),
    isEquityLike ? companyProfile(symbol).catch(() => null) : Promise.resolve(null),
  ]);

  // Events: SEC filings for this ticker, plus stored events naming the company.
  const repo = await getRepository();
  const since = new Date(Date.now() - 8 * 86_400_000).toISOString();
  const byTicker = (await repo.scan({ from: since, type: ["BUSINESS"] })).filter((e) => String(e.metrics.ticker ?? "").toUpperCase() === symbol);
  const shortName = company?.name.replace(/,?\s+(inc|corp|corporation|co|ltd|plc|holdings|group)\.?$/i, "").trim();
  const byName = shortName && shortName.length >= 4 ? (await repo.query({ from: since, q: shortName.toLowerCase(), limit: 10 })).events : [];
  const events = [...new Map([...byTicker, ...byName].map((e) => [e.id, e])).values()].slice(0, 12).map(toEventSummary);

  return json({ symbol, range: range.data, history, company, events, note: "Prices: Yahoo Finance (unofficial, delayed). Company data: SEC EDGAR. Not investment advice." });
});
