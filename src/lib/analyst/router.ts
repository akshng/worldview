/**
 * Deterministic tool routing: keyword / entity detection picks the tools, so a
 * small local model only has to write the summary. Also used to plan the
 * watchlist desk note. Pure and tested.
 */
import type { PlannedCall } from "./protocol";

export interface RouteContext {
  watchlist: string[];
  findCountry?: (name: string) => { code: string; name: string } | null;
}

export const MAX_TOOL_CALLS = 6;

/** Uppercase words that look like tickers but aren't. */
const NOT_TICKERS = new Set(
  "I A AN AM AS AT BE BY DO GO IF IN IS IT ME MY NO OF OK ON OR SO TO UP US WE UK EU UN AI CEO CFO GDP CPI PPI PCE FED FOMC ETF ETFS IPO IPOS OPEC USD EUR GBP JPY CNY YOY QOQ API SEC CFTC COT VIX WTI LNG NATO OECD IMF ECB BOJ BOE PMI ISM ESG EPS PE EV EVS FX AND THE FOR WHAT WHY HOW WHO ANY ALL NEW TODAY NOW 10-K 13F".split(" "),
);

const COMPANIES: Record<string, string> = {
  nvidia: "NVDA", apple: "AAPL", microsoft: "MSFT", tesla: "TSLA", amazon: "AMZN", alphabet: "GOOGL", google: "GOOGL", meta: "META", facebook: "META",
  netflix: "NFLX", amd: "AMD", intel: "INTC", broadcom: "AVGO", tsmc: "TSM", "berkshire": "BRK-B", jpmorgan: "JPM", exxon: "XOM", chevron: "CVX",
  boeing: "BA", walmart: "WMT", palantir: "PLTR", oracle: "ORCL", salesforce: "CRM", coinbase: "COIN", micron: "MU", qualcomm: "QCOM",
};

interface Topic {
  re: RegExp;
  symbols?: string[];
  calls: PlannedCall[];
}

const TOPICS: Topic[] = [
  {
    re: /\b(oil|crude|brent|wti|opec|petroleum|hormuz|tanker|refin\w*)\b/i,
    symbols: ["BZ=F", "CL=F", "XLE"],
    calls: [
      { tool: "search_events", args: { query: "oil", hours: 48 } },
      { tool: "futures_curves", args: { curve: "crude" } },
      { tool: "chokepoints", args: { days: 7 } },
      { tool: "cftc_positioning", args: { market: "crude" } },
    ],
  },
  { re: /\b(natural gas|lng|gas prices?)\b/i, symbols: ["NG=F"], calls: [{ tool: "search_events", args: { query: "gas", hours: 48 } }, { tool: "energy_grids", args: {} }] },
  { re: /\b(gold|silver|precious metals?|safe.haven)\b/i, symbols: ["GC=F", "SI=F", "DX-Y.NYB"], calls: [{ tool: "cftc_positioning", args: { market: "gold" } }] },
  { re: /\b(copper|metals?)\b/i, symbols: ["HG=F"], calls: [] },
  { re: /\b(wheat|corn|grain|soy\w*|coffee|cocoa|sugar|agri\w*)\b/i, symbols: ["ZW=F", "ZC=F", "ZS=F", "KC=F"], calls: [{ tool: "search_events", args: { query: "drought", hours: 168 } }] },
  {
    re: /\b(inflation|cpi|pce|prices? index)\b/i,
    calls: [{ tool: "macro_indicators", args: { group: "Inflation" } }, { tool: "economic_calendar", args: { days: 14 } }],
  },
  { re: /\b(jobs?|payrolls?|unemployment|labou?r market|jobless)\b/i, calls: [{ tool: "macro_indicators", args: { group: "Jobs" } }, { tool: "economic_calendar", args: { days: 14 } }] },
  {
    re: /\b(fed|fomc|rates?|yields?|treasur\w*|bonds?|curve|recession)\b/i,
    symbols: ["DGS2", "DGS10"],
    calls: [{ tool: "yield_curve", args: {} }, { tool: "macro_indicators", args: { group: "Rates & credit" } }, { tool: "prediction_markets", args: { topic: "economics" } }],
  },
  { re: /\b(auctions?)\b/i, calls: [{ tool: "treasury_auctions", args: {} }] },
  { re: /\b(calendar|this week|data releases?|upcoming)\b/i, calls: [{ tool: "economic_calendar", args: { days: 7 } }] },
  { re: /\b(crypto\w*|bitcoin|btc|ether\w*|eth|solana|stablecoins?)\b/i, symbols: ["BTC-USD", "ETH-USD"], calls: [{ tool: "crypto_markets", args: {} }, { tool: "cftc_positioning", args: { market: "bitcoin" } }] },
  { re: /\b(odds|probabilit\w*|prediction markets?|polymarket|kalshi|elections?)\b/i, calls: [{ tool: "prediction_markets", args: {} }] },
  { re: /\b(positioning|cot|speculators?|net long|net short)\b/i, calls: [{ tool: "cftc_positioning", args: {} }] },
  { re: /\b(gainers?|losers?|movers?|most active|biggest moves?)\b/i, calls: [{ tool: "movers", args: { list: "gainers" } }, { tool: "movers", args: { list: "losers" } }] },
  { re: /\b(earnings|results|reported)\b/i, calls: [{ tool: "earnings_releases", args: {} }] },
  { re: /\b(ipos?|s-1|listings?)\b/i, calls: [{ tool: "ipo_filings", args: {} }] },
  { re: /\b(13f|hedge funds?|fund holdings?|berkshire|bridgewater|pershing|ark invest|citadel|holders?)\b/i, calls: [] },
  { re: /\b(chokepoints?|shipping|suez|red sea|panama canal|malacca|strait)\b/i, calls: [{ tool: "chokepoints", args: { days: 7 } }, { tool: "search_events", args: { category: "MARITIME", hours: 72 } }] },
  { re: /\b(cyber\w*|hack\w*|ransomware|vulnerabilit\w*|cve)\b/i, calls: [{ tool: "cyber", args: {} }] },
  { re: /\b(travel|advisor(y|ies))\b/i, calls: [{ tool: "travel_advisories", args: {} }] },
  { re: /\b(electricity|power grids?|grid|energy prices?)\b/i, calls: [{ tool: "energy_grids", args: {} }] },
  { re: /\b(climate|space weather|solar storm|el ni[nñ]o|enso|asteroid)\b/i, calls: [{ tool: "planet", args: {} }] },
  { re: /\b(trend\w*|searching|viral)\b/i, calls: [{ tool: "trends", args: {} }] },
  { re: /\b(war|conflict|attack\w*|strikes?|military|missiles?|geopolitic\w*)\b/i, symbols: ["GC=F", "^VIX"], calls: [{ tool: "search_events", args: { category: "CONFLICT", hours: 48 } }, { tool: "exposure", args: {} }] },
  { re: /\b(earthquake|hurricane|typhoon|cyclone|flood|wildfire|disaster)\b/i, calls: [{ tool: "search_events", args: { category: "DISASTER", hours: 72 } }, { tool: "exposure", args: {} }] },
  { re: /\b(fx|currenc\w*|dollar|euro|yen|yuan|forex)\b/i, symbols: ["DX-Y.NYB", "EURUSD=X", "USDJPY=X"], calls: [{ tool: "cftc_positioning", args: { market: "dollar" } }] },
];

const MACRO_WORDS = /\b(market|markets|stocks|equities|s&p|nasdaq|dow|risk|sentiment|today|overview|rundown|wrap)\b/i;
/** "What should I buy?", picks, opportunities → the stock-ideas screen. */
export const BUY_WORDS = /\b(buy|buying|invest(ing)? in|picks?|stock ideas?|opportunit\w*|undervalued|best stocks?|what (stocks? )?should i (get|own|purchase)|bargains?)\b/i;
const RESEARCH_WORDS = /\b(research|why (did|is)|dig into|deep dive|look into|analy[sz]e|worth it|should i)\b/i;
const WATCHLIST_WORDS = /\b(my (watch ?list|portfolio|positions|holdings|stocks|tickers)|watch ?list)\b/i;

/** Tickers named in the question: $NVDA, NVDA, BRK.B, or a well-known company name. */
export function detectTickers(question: string): string[] {
  const out: string[] = [];
  for (const m of question.matchAll(/\$?\b([A-Z]{1,5}(?:[.-][A-Z]{1,2})?)\b/g)) {
    const t = m[1];
    if (m[0].startsWith("$") || !NOT_TICKERS.has(t)) if (t.length >= 2 || m[0].startsWith("$")) out.push(t.replace(".", "-"));
  }
  const lower = question.toLowerCase();
  for (const [name, t] of Object.entries(COMPANIES)) if (new RegExp(`\\b${name}\\b`).test(lower)) out.push(t);
  return [...new Set(out)];
}

/** Country names mentioned in the question (resolved by the app's gazetteer). */
export function detectCountries(question: string, find?: RouteContext["findCountry"]): Array<{ code: string; name: string }> {
  if (!find) return [];
  const out = new Map<string, { code: string; name: string }>();
  const words = question.replace(/[^\p{L}\s-]/gu, " ").split(/\s+/).filter(Boolean);
  for (let n = 3; n >= 1; n--) {
    for (let i = 0; i + n <= words.length; i++) {
      const phrase = words.slice(i, i + n).join(" ");
      if (phrase.length < 4 && phrase !== phrase.toUpperCase()) continue; // skip short lowercase words ("us", "in")
      if (n === 1 && /^[A-Z]{2,3}$/.test(phrase)) continue; // a bare code is more likely a ticker
      const c = find(phrase);
      if (c) out.set(c.code, c);
    }
  }
  return [...out.values()].slice(0, 2);
}

function push(plan: PlannedCall[], call: PlannedCall) {
  const key = `${call.tool}:${JSON.stringify(call.args)}`;
  if (!plan.some((c) => `${c.tool}:${JSON.stringify(c.args)}` === key)) plan.push(call);
}

/** Pick up to MAX_TOOL_CALLS tool calls for a question. */
export function routeQuestion(question: string, ctx: RouteContext): PlannedCall[] {
  const plan: PlannedCall[] = [];
  const symbols: string[] = [];
  const tickers = detectTickers(question).filter((t) => !/[=^]/.test(t));
  const wantsWatchlist = WATCHLIST_WORDS.test(question) && ctx.watchlist.length > 0;
  const topics = TOPICS.filter((t) => t.re.test(question));

  // 0. Buy questions: ranked (and researched) ideas, unless it's about one named stock,
  //    which gets researched directly.
  const wantsIdeas = BUY_WORDS.test(question) && !tickers.length;
  if (wantsIdeas) push(plan, { tool: "stock_ideas", args: {} });
  const equityTickers = tickers.filter((t) => /^[A-Z][A-Z-]{0,6}$/.test(t));
  if ((BUY_WORDS.test(question) || RESEARCH_WORDS.test(question)) && equityTickers.length)
    for (const t of equityTickers.slice(0, 2)) push(plan, { tool: "research_stock", args: { ticker: t } });

  // 1. Quotes first: tickers, topic instruments, watchlist.
  symbols.push(...tickers.slice(0, 5));
  for (const t of topics) symbols.push(...(t.symbols ?? []));
  if (wantsWatchlist || (wantsIdeas && !tickers.length)) symbols.push(...ctx.watchlist);
  const uniq = [...new Set(symbols)].slice(0, 10);
  if (uniq.length) push(plan, { tool: "get_quote", args: { symbols: uniq } });

  // 2. Single-company deep dive.
  if (tickers.length) {
    const t = tickers[0];
    const equityLike = /^[A-Z][A-Z-]{0,6}$/.test(t);
    if (equityLike) push(plan, { tool: "company_profile", args: { ticker: t } });
    push(plan, { tool: "price_history", args: { symbol: t, range: "1mo" } });
    if (/\b(10-?k|annual report|risks?|filing)\b/i.test(question) && equityLike) push(plan, { tool: "annual_report_analysis", args: { ticker: t } });
    if (/\b(funds?|holders?|13f|owns?|institution\w*)\b/i.test(question)) push(plan, { tool: "held_by", args: { ticker: t } });
    if (/\b(earnings|results)\b/i.test(question)) push(plan, { tool: "earnings_releases", args: { query: t } });
    push(plan, { tool: "search_events", args: { query: t, hours: 168 } });
  }

  // 3. Watchlist: world events with exposure, events per ticker.
  if (wantsWatchlist) {
    push(plan, { tool: "exposure", args: { symbols: ctx.watchlist.slice(0, 10) } });
    for (const t of ctx.watchlist.filter((s) => /^[A-Z][A-Z-]{0,6}$/.test(s)).slice(0, 2)) push(plan, { tool: "search_events", args: { query: t, hours: 168 } });
  }

  // 4. Topic tools.
  for (const t of topics) for (const c of t.calls) push(plan, c);

  // 5. Countries.
  for (const c of detectCountries(question, ctx.findCountry)) {
    push(plan, { tool: "search_events", args: { country: c.code, hours: 72 } });
    if (/\b(economy|gdp|profile|inflation|debt|macro)\b/i.test(question)) push(plan, { tool: "country_profile", args: { country: c.code } });
  }

  // 6. General market questions or nothing matched: the snapshot and event exposure.
  //    (A buy question already has its answer from stock_ideas; skip the big snapshot.)
  if ((MACRO_WORDS.test(question) && !wantsIdeas) || plan.length === 0) {
    push(plan, { tool: "market_snapshot", args: {} });
    push(plan, { tool: "exposure", args: {} });
  }
  if (plan.length === 0) push(plan, { tool: "search_events", args: { query: question.slice(0, 80) } });
  return plan.slice(0, MAX_TOOL_CALLS);
}

/** Plan for the watchlist desk note. */
export function deskNotePlan(watchlist: string[]): PlannedCall[] {
  const plan: PlannedCall[] = [];
  if (watchlist.length) plan.push({ tool: "get_quote", args: { symbols: watchlist.slice(0, 10) } });
  plan.push({ tool: "market_snapshot", args: {} });
  plan.push({ tool: "exposure", args: watchlist.length ? { symbols: watchlist.slice(0, 10) } : {} });
  const equities = watchlist.filter((s) => /^[A-Z][A-Z-]{0,6}$/.test(s));
  for (const t of equities.slice(0, 1)) plan.push({ tool: "search_events", args: { query: t, hours: 168 } });
  plan.push({ tool: "earnings_releases", args: {} });
  plan.push({ tool: "economic_calendar", args: { days: 5 } });
  return plan.slice(0, MAX_TOOL_CALLS);
}
