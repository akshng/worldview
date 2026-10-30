/**
 * Deterministic tool routing: keyword / entity detection picks the tools, so a
 * small local model only has to write the summary. Also used to plan the
 * watchlist desk note. Pure and tested.
 */
import type { PlannedCall } from "./protocol";

export interface RouteContext {
  watchlist: string[];
  findCountry?: (name: string) => { code: string; name: string } | null;
  /** Name → point, for live tracking and infrastructure questions. */
  resolvePlace?: (name: string) => { name: string } | null;
}

export const MAX_TOOL_CALLS = 6;

/** Uppercase words that look like tickers but aren't. */
const NOT_TICKERS = new Set(
  "I A AN AM AS AT BE BY DO GO IF IN IS IT ME MY NO OF OK ON OR SO TO UP US WE UK EU UN AI CEO CFO GDP CPI PPI PCE FED FOMC ETF ETFS IPO IPOS OPEC USD EUR GBP JPY CNY YOY QOQ API SEC CFTC COT VIX WTI LNG NATO OECD IMF ECB BOJ BOE PMI ISM ESG EPS PE EV EVS FX AND THE FOR WHAT WHY HOW WHO ANY ALL NEW TODAY NOW 10-K 13F FEMA CISA ICS CVE CVES EMA CHMP PRAC NOAA SWPC CME".split(" "),
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
  // Sources added for the analyst to reach every kind of data in the app.
  { re: /\b(central banks?|fed|fomc|ecb|bank of (england|japan|canada)|boe|boj|rate (decision|cut|hike)s?)\b/i, calls: [{ tool: "search_events", args: { source: "central-banks", hours: 168 } }] },
  { re: /\bsanction\w*\b/i, calls: [{ tool: "search_events", args: { source: "ofac-sanctions", hours: 168 } }, { tool: "search_events", args: { source: "sanctions-news", hours: 168 } }] },
  { re: /\b(outages?|is (\w+ )?down|aws|azure|gcp|google cloud|cloudflare|status pages?|service disruptions?)\b/i, calls: [{ tool: "search_events", args: { source: "cloud-status", hours: 48 } }, { tool: "search_events", args: { source: "app-status", hours: 48 } }] },
  { re: /\brecall(s|ed)?\b/i, calls: [{ tool: "search_events", args: { source: "fda-recalls", hours: 168 } }, { tool: "search_events", args: { source: "cpsc-recalls", hours: 168 } }] },
  { re: /\b(data breach\w*|breach\w*|leaked|pwned)\b/i, calls: [{ tool: "search_events", args: { source: "hibp-breaches", hours: 168 } }, { tool: "cyber", args: {} }] },
  { re: /\b(united nations|security council|general assembly|secretary-general)\b/i, calls: [{ tool: "search_events", args: { source: "un-press", hours: 168 } }] },
  { re: /\b(briefing|catch me up|what('s| is) happening|what happened today|summary of (today|the day)|today in the world)\b/i, calls: [{ tool: "daily_briefing", args: {} }] },
  { re: /\b(data sources?|what data|which sources|where does (the|your) data)\b/i, calls: [{ tool: "data_sources", args: {} }] },
  { re: /\b(pentagon|department of (war|defense)|defen[cs]e contracts?|dod|hegseth)\b/i, calls: [{ tool: "search_events", args: { source: "defense-releases", hours: 168 } }] },
  { re: /\b(doj|justice department|indict\w*|charged|prosecut\w*|antitrust)\b/i, calls: [{ tool: "search_events", args: { source: "doj-press", hours: 168 } }] },
  { re: /\b(cftc|regulators?|rulemaking)\b/i, calls: [{ tool: "search_events", args: { source: "market-regulators", hours: 168 } }] },
  { re: /\b(european commission|eu commission|brussels|von der leyen)\b/i, calls: [{ tool: "search_events", args: { source: "eu-commission", hours: 168 } }] },
  { re: /\b(tariffs?|wto|ustr|trade (war|deal|policy|disputes?))\b/i, calls: [{ tool: "search_events", args: { source: "trade-policy", hours: 168 } }] },
  { re: /\b(gdp|retail sales|housing starts|durable goods|trade deficit|economic (data|releases?)|bea|census bureau)\b/i, calls: [{ tool: "search_events", args: { source: "us-economic-releases", hours: 168 } }] },
  { re: /\b(eia|refiner(y|ies)|oil inventor\w*|gasoline|crude stocks)\b/i, calls: [{ tool: "search_events", args: { source: "eia-energy", hours: 168 } }] },
  { re: /\b(medwatch|medical devices?|drug safety)\b/i, calls: [{ tool: "search_events", args: { source: "fda-medwatch", hours: 336 } }] },
  { re: /\b(nasa|artemis|space (mission|agency))\b/i, calls: [{ tool: "search_events", args: { source: "nasa-news", hours: 168 } }] },
  { re: /\b(humanitarian|aid appeals?|ifrc|red cross|famine|refugees?)\b/i, calls: [{ tool: "search_events", args: { source: "ifrc-appeals", hours: 720 } }] },
  { re: /\b(cisa|ics advisor\w*|cyber ?security advisor\w*|exploited vulnerabilit\w*|cves?)\b/i, calls: [{ tool: "search_events", args: { source: "cisa-advisories", hours: 168 } }] },
  { re: /\b(fema|disaster declarations?|emergency declarations?|declared (a )?(major )?disaster)\b/i, calls: [{ tool: "search_events", args: { source: "fema-declarations", hours: 720 } }] },
  { re: /\b(space weather|geomagnetic|solar (storm|flare)s?|auroras?|northern lights|swpc|coronal mass ejections?)\b/i, calls: [{ tool: "search_events", args: { source: "swpc-alerts", hours: 72 } }] },
  { re: /\b(european medicines agency|chmp|ema (approv\w*|recommend\w*|review\w*|safety))\b/i, calls: [{ tool: "search_events", args: { source: "ema-medicines", hours: 336 } }] },
  { re: /\b(trading halts?|halted|halts?)\b/i, calls: [{ tool: "search_events", args: { source: "nasdaq-halts", hours: 48 } }] },
  { re: /\binsider (buying|buys|purchases?)\b/i, calls: [{ tool: "search_events", args: { source: "sec-insider-buys", hours: 168 } }] },
  { re: /\b(sec (charges?|enforcement|lawsuits?|suspensions?)|enforcement actions?|securities fraud)\b/i, calls: [{ tool: "search_events", args: { source: "sec-enforcement", hours: 168 } }] },
  { re: /\b(outbreaks?|diseases?|ebola|measles|cholera|mpox|bird flu|h5n1|epidemic|pandemic|ecdc)\b/i, calls: [{ tool: "search_events", args: { source: "ecdc", hours: 168 } }, { tool: "search_events", args: { category: "HEALTH", hours: 168 } }] },
  { re: /\b(iaea|nuclear (plant|safety|power|program\w*)|zaporizhzhia)\b/i, calls: [{ tool: "search_events", args: { source: "iaea", hours: 168 } }] },
  { re: /\b(volcan\w*|eruptions?|ash cloud)\b/i, calls: [{ tool: "search_events", args: { source: "volcanic-ash", hours: 72 } }, { tool: "search_events", args: { source: "gvp-volcano", hours: 240 } }, { tool: "search_events", args: { category: "VOLCANO", hours: 168 } }] },
  { re: /\b(iss|space station)\b/i, calls: [{ tool: "live_tracking", args: { kind: "iss" } }] },
  { re: /\b(aurora|northern lights|southern lights)\b/i, calls: [{ tool: "live_tracking", args: { kind: "aurora" } }, { tool: "planet", args: {} }] },
  { re: /\bsatellites?\b/i, calls: [{ tool: "live_tracking", args: { kind: "satellites" } }] },
  { re: /\b(earnings (calendar|this week|next week|tomorrow|today|season)|who reports|reports? earnings|when (does|do|is) \w+ (report|reporting)|upcoming earnings)\b/i, calls: [{ tool: "earnings_calendar", args: { days: 5 } }] },
  { re: /\b(fx|currenc\w*|dollar|euro|yen|yuan|forex)\b/i, symbols: ["DX-Y.NYB", "EURUSD=X", "USDJPY=X"], calls: [{ tool: "cftc_positioning", args: { market: "dollar" } }] },
];

const SHIP_WORDS = /\b(ships?|vessels?|tankers?|cargo ships?|shipping traffic|boats?|fleet)\b/i;
const AIR_WORDS = /\b(planes?|aircraft|flights?|air traffic|jets?)\b/i;
const MIL_AIR_WORDS = /\bmilitary (aircraft|jets?|planes?|flights?)\b/i;
const INFRA_WORDS = /\b(infrastructure|undersea cables?|cables?|pipelines?|ports?|military bases?|bases|nuclear (plants?|reactors?)|power plants?|data cent(er|re)s?|lng terminals?)\b/i;
const INFRA_TYPES: Array<[RegExp, string]> = [
  [/\bcables?\b/i, "cables"], [/\bpipelines?\b/i, "pipelines"], [/\bports?\b/i, "ports"], [/\bbases?\b/i, "bases"],
  [/\bnuclear\b/i, "nuclear"], [/\bpower plants?\b/i, "power"], [/\bdata cent(er|re)s?\b/i, "datacenters"], [/\blng\b/i, "lng"],
];
const PLACE_HINT = /\b(?:near|in|over|around|off|at|through|by)\s+(?:the\s+)?([A-Za-z][\w'-]*(?:\s+(?:of|el|al)?\s*[A-Za-z][\w'-]*){0,3})/g;
const KNOWN_WATERS = /\b(hormuz|suez|malacca|bab[ -]el[ -]mandeb|bosporus|panama canal|red sea|taiwan strait|south china sea|black sea|english channel|gibraltar)\b/i;

/** The place a question is about, if the app can locate it. */
export function detectPlace(question: string, ctx: RouteContext): string | null {
  if (!ctx.resolvePlace) return null;
  const tries: string[] = [];
  const w = question.match(KNOWN_WATERS);
  if (w) tries.push(w[0]);
  for (const m of question.matchAll(PLACE_HINT)) {
    const words = m[1].replace(/[?.!,]+$/, "").split(/\s+/);
    for (let n = words.length; n >= 1; n--) tries.push(words.slice(0, n).join(" "));
  }
  for (const c of detectCountries(question, ctx.findCountry)) tries.push(c.name);
  for (const t of tries) if (t.length >= 3 && ctx.resolvePlace(t)) return t;
  return null;
}

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
  // "Explain how tariffs work": a concept, not today's data, even if it names a topic.
  if (isExplanation(question)) return [];
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

  // 0b. Map questions: what's moving where, and what infrastructure is there.
  const place = SHIP_WORDS.test(question) || AIR_WORDS.test(question) || INFRA_WORDS.test(question) ? detectPlace(question, ctx) : null;
  if (place && SHIP_WORDS.test(question)) push(plan, { tool: "live_tracking", args: { kind: "ships", place } });
  if (MIL_AIR_WORDS.test(question)) push(plan, { tool: "live_tracking", args: { kind: "military_aircraft", ...(place ? { place } : {}) } });
  else if (place && AIR_WORDS.test(question)) push(plan, { tool: "live_tracking", args: { kind: "aircraft", place } });
  if (place && INFRA_WORDS.test(question)) {
    const types = INFRA_TYPES.filter(([re]) => re.test(question)).map(([, t]) => t);
    push(plan, { tool: "infrastructure_near", args: { place, ...(types.length ? { types } : {}) } });
  }

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
    if (/\b(insiders?|form 4|executives? (buy|sell)\w*)\b/i.test(question) && equityLike) push(plan, { tool: "insider_trades", args: { ticker: t } });
    if (/\bdividends?\b|\byield\b/i.test(question)) push(plan, { tool: "dividends", args: { symbol: t } });
    if (/\bshort(s|ing| sell\w*| volume| interest)?\b/i.test(question) && equityLike) push(plan, { tool: "short_volume", args: { symbol: t } });
    if (/\b(why|what happened|news|headlines?)\b/i.test(question)) push(plan, { tool: "news_headlines", args: { query: `${t} stock` } });
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
    // "protests in Serbia": the headlines say what's actually happening; events add the map's view.
    if (EVENT_WORDS.test(question)) push(plan, { tool: "news_headlines", args: { query: searchTopic(question) || c.name } });
    push(plan, { tool: "search_events", args: { country: c.code, hours: 72 } });
    if (/\b(economy|gdp|profile|inflation|debt|macro)\b/i.test(question)) push(plan, { tool: "country_profile", args: { country: c.code } });
  }

  // 5b. "Why did …" / news about a topic without a ticker: search the news.
  if (!tickers.length && /\b(why (did|is|are|has|have)|what happened (to|with|in)|news (on|about)|headlines? (on|about))\b/i.test(question)) {
    const topic = question.replace(/\b(why (did|is|are|has|have)|what happened (to|with|in)|news (on|about)|headlines? (on|about))\b/gi, "").replace(/[?!.]/g, "").trim();
    if (topic.length >= 3) push(plan, { tool: "news_headlines", args: { query: topic.slice(0, 80) } });
  }

  // 6. General market questions: the snapshot and event exposure.
  //    (A buy question already has its answer from stock_ideas; skip the big snapshot.)
  if (MACRO_WORDS.test(question) && !wantsIdeas && !isKnowledgeQuestion(question)) {
    push(plan, { tool: "market_snapshot", args: {} });
    push(plan, { tool: "exposure", args: {} });
  }
  // 7. Nothing matched. An explanation/definition/how-to question needs no data (the model
  //    answers from general knowledge); anything else is searched in the news and the event store.
  if (plan.length === 0 && !isKnowledgeQuestion(question) && !isChitChat(question)) {
    const topic = searchTopic(question);
    if (topic) {
      push(plan, { tool: "news_headlines", args: { query: topic } });
      push(plan, { tool: "search_events", args: { query: topic, hours: 168 } });
    }
  }
  return plan.slice(0, MAX_TOOL_CALLS);
}

const NOW_WORDS = /\b(today|now|right now|currently|current|latest|this (week|month|morning)|tonight|yesterday|price|trading at|live|recent(ly)?|breaking|so far)\b/i;
const KNOWLEDGE_START = /^\s*(what (is|are|was|were|does|do)( an?| the)?|what'?s (an?|the)|explain|define|definition|meaning of|how (does|do|did|is|are|can|would|should)|how to|why (do|does|is|are|would|did .* (happen|start))|difference between|teach me|help me understand|who was|when (was|were|did)|what happens (if|when)|can you explain|eli5|summari[sz]e the history)/i;

/** Background/explanations answered from general knowledge (no live data needed). */
const EVENT_WORDS = /\b(protests?|war|fighting|attacks?|elections?|strikes?|crisis|outbreak|earthquake|storm|hurricane|ceasefire|talks|summit|coup|sanctions?|tariffs? on|deal between|scandal|lawsuit|shooting|explosion|fire in)\b/i;

export function isKnowledgeQuestion(q: string): boolean {
  return KNOWLEDGE_START.test(q) && !NOW_WORDS.test(q) && !EVENT_WORDS.test(q) && !detectTickers(q).filter((t) => !/[=^]/.test(t)).length;
}

const EXPLAIN_START = /^\s*(explain|define|definition of|meaning of|how (does|do|did|would|can) [\w\s]{0,30}(work|affect|impact|influence|relate|cause|happen)|difference between|teach me|help me understand|eli5|what (is|are) (an?|the concept of)\s|can you explain)/i;

/** Concept questions answered from general knowledge alone. */
export function isExplanation(q: string): boolean {
  return EXPLAIN_START.test(q) && !NOW_WORDS.test(q) && !EVENT_WORDS.test(q) && !detectTickers(q).filter((t) => !/[=^]/.test(t)).length;
}

export function isChitChat(q: string): boolean {
  return /^\s*(hi|hey|hello|yo|thanks|thank you|ty|ok(ay)?|cool|nice|lol|who are you|what can you do|help)\b[\s!.?]*$/i.test(q);
}

/** The subject of a free-form question, for a news/event search. */
export function searchTopic(q: string): string {
  return q
    .replace(/[?!.]/g, " ")
    .replace(/\b(what('s| is| are)?|whats|tell me|give me|any|anything|about|the|latest|news|on|with|happening|going on|right now|today|currently|is there|are there|can you|please|me|update|updates)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
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
