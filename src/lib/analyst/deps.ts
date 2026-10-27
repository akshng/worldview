/** Real implementations behind the analyst's tools (server only). */
import "server-only";
import { getRepository } from "@/lib/server/context";
import { changeSince, getHistory, getMarketSnapshot, getQuote, getYieldCurve } from "@/lib/finance/service";
import { getScreener } from "@/lib/finance/screeners";
import { searchInstruments } from "@/lib/finance/search";
import { getMacroDashboard } from "@/lib/finance/macro";
import { getEconomicCalendar } from "@/lib/finance/calendar";
import { getCot } from "@/lib/finance/cot";
import { getPredictionMarkets } from "@/lib/finance/prediction-markets";
import { getCryptoMarkets } from "@/lib/finance/crypto";
import { getRecentAuctions } from "@/lib/finance/auctions";
import { getTermStructure } from "@/lib/finance/term-structure";
import { companyProfile } from "@/lib/finance/company";
import { filingAnalysisStatus, startFilingAnalysis } from "@/lib/finance/filing-analysis";
import { TRACKED_MANAGERS } from "@/lib/finance/thirteenf";
import { holdersOf, managerHoldings } from "@/lib/finance/thirteenf-service";
import { getEarningsReleases } from "@/lib/finance/earnings";
import { getRegistrations } from "@/lib/finance/ipos";
import { marketExposure, marketMovers } from "@/lib/finance/exposure";
import { getTrends } from "@/lib/trends";
import { getEnergy } from "@/lib/energy";
import { getPlanetDashboard } from "@/lib/planet";
import { getChokepointMonitor } from "@/lib/infra/monitor";
import { getSecurityDashboard } from "@/lib/cyber";
import { getCountryProfile } from "@/lib/country-profile";
import { findCountryByName, getCountry } from "@/lib/geo/gazetteer";
import type { WorldEvent } from "@/types/events";
import type { ToolDeps } from "./tools";

export function findCountry(nameOrCode: string): { code: string; name: string } | null {
  const s = nameOrCode.trim();
  const c = (/^[A-Za-z]{2,3}$/.test(s) ? getCountry(s) : undefined) ?? findCountryByName(s);
  return c ? { code: c.code, name: c.name } : null;
}

export const realDeps: ToolDeps = {
  repo: getRepository,
  now: Date.now,
  getQuote: (s) => getQuote(s),
  getHistory,
  changeSince,
  getMarketSnapshot,
  getScreener,
  searchInstruments,
  getMacroDashboard,
  getEconomicCalendar,
  getCot,
  getPredictionMarkets,
  getCryptoMarkets,
  getRecentAuctions,
  getYieldCurve,
  getTermStructure,
  companyProfile,
  filingAnalysisStatus,
  startFilingAnalysis,
  trackedManagers: TRACKED_MANAGERS,
  managerHoldings,
  holdersOf,
  scanSetups: async (opts) => (await import("@/lib/finance/setups-service")).scanSetups(opts),
  setupsTrackRecord: async () => (await import("@/lib/finance/setups-score-service")).backtestSetups(),
  getEarningsReleases: () => getEarningsReleases(),
  getRegistrations,
  getTrends,
  getEnergy,
  getPlanetDashboard,
  getChokepointMonitor,
  getSecurityDashboard,
  getCountryProfile,
  marketExposure,
  marketMovers: (events, limit) => marketMovers(events, limit) as Array<{ event: WorldEvent; exposure: ReturnType<typeof marketExposure> }>,
  findCountry,
};
