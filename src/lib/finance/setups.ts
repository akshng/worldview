/**
 * Daily "setups worth a look" scan. Transparent price rules (not predictions) over a
 * fixed large-cap universe plus today's large-cap losers / most-active:
 *   - Pullback in an uptrend: above the 200-day average, 8–25% off the 52-week high, RSI ≤ 38
 *   - Oversold: RSI(14) ≤ 25
 *   - Sharp drop: ≤ −7% on the day or ≤ −12% over 5 days
 *   - Near 52-week low (flagged as a risk, never on its own)
 * Each hit gets a score; only the strongest few are reported. Information only — not advice.
 */

export const SETUP_UNIVERSE = [
  "AAPL", "MSFT", "NVDA", "GOOGL", "AMZN", "META", "AVGO", "TSLA", "BRK-B", "JPM", "V", "MA", "LLY", "UNH", "XOM", "JNJ", "PG", "HD", "COST", "ABBV",
  "MRK", "KO", "PEP", "WMT", "BAC", "CVX", "ORCL", "CRM", "ADBE", "AMD", "NFLX", "TMO", "ABT", "MCD", "CSCO", "ACN", "LIN", "DHR", "WFC", "TXN",
  "QCOM", "INTU", "AMAT", "IBM", "CAT", "GE", "HON", "UNP", "LOW", "SPGI", "GS", "MS", "BLK", "AXP", "ISRG", "NOW", "BKNG", "PFE", "AMGN", "VRTX",
  "UBER", "PANW", "MU", "LRCX", "KLAC", "ADI", "DE", "LMT", "RTX", "BA", "NKE", "SBUX", "DIS", "CMCSA", "T", "VZ", "TSM", "ASML", "SHOP", "PLTR",
];

export interface SetupMetrics {
  price: number;
  change1d: number | null;
  change5d: number | null;
  rsi14: number | null;
  sma50: number | null;
  sma200: number | null;
  high52: number;
  low52: number;
  fromHigh: number; // % below 52w high (negative)
  fromLow: number; // % above 52w low
}

export interface Setup {
  symbol: string;
  name: string;
  metrics: SetupMetrics;
  signals: string[];
  risks: string[];
  score: number;
  funds?: number | null;
  /** open-market insider buying in the last 90 days (SEC Form 4) */
  insiders?: { buyers: number; buyValue: number; sellers: number; sellValue: number } | null;
  note?: string;
}

/**
 * Insider buying adds to a price setup (never creates one): two or more insiders
 * buying is the stronger signal; one large buy counts for less.
 */
export function applyInsiders(s: Setup, ins: NonNullable<Setup["insiders"]>): Setup {
  const usd = (v: number) => (v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : `$${Math.round(v / 1e3)}K`);
  const out = { ...s, insiders: ins, signals: [...s.signals] };
  if (ins.buyers >= 2) {
    out.signals.push(`Insider buying: ${ins.buyers} insiders bought ${usd(ins.buyValue)} on the open market in 90 days`);
    out.score = Math.round((s.score + 1.5) * 100) / 100;
  } else if (ins.buyers === 1 && ins.buyValue >= 100_000) {
    out.signals.push(`Insider buying: one insider bought ${usd(ins.buyValue)} on the open market in 90 days`);
    out.score = Math.round((s.score + 0.75) * 100) / 100;
  }
  return out;
}

const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** Wilder RSI over the last `n` changes. */
export function rsi(closes: number[], n = 14): number | null {
  if (closes.length < n + 1) return null;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= n; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) gain += d;
    else loss -= d;
  }
  gain /= n;
  loss /= n;
  for (let i = n + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    gain = (gain * (n - 1) + Math.max(d, 0)) / n;
    loss = (loss * (n - 1) + Math.max(-d, 0)) / n;
  }
  if (loss === 0) return 100;
  return 100 - 100 / (1 + gain / loss);
}

export function metrics(closes: number[]): SetupMetrics | null {
  if (closes.length < 60) return null;
  const price = closes[closes.length - 1];
  const at = (k: number) => (closes.length > k ? closes[closes.length - 1 - k] : null);
  const ch = (k: number) => {
    const p = at(k);
    return p ? ((price - p) / p) * 100 : null;
  };
  const high52 = Math.max(...closes);
  const low52 = Math.min(...closes);
  return {
    price,
    change1d: ch(1),
    change5d: ch(5),
    rsi14: rsi(closes.slice(-120)),
    sma50: closes.length >= 50 ? avg(closes.slice(-50)) : null,
    sma200: closes.length >= 200 ? avg(closes.slice(-200)) : null,
    high52,
    low52,
    fromHigh: ((price - high52) / high52) * 100,
    fromLow: ((price - low52) / low52) * 100,
  };
}

/** Apply the rules; null when nothing fires (or only risks do). */
export function evaluate(symbol: string, name: string, m: SetupMetrics): Setup | null {
  const signals: string[] = [];
  const risks: string[] = [];
  let score = 0;
  const uptrend = m.sma200 !== null && m.price > m.sma200 && (m.sma50 === null || m.sma50 > m.sma200);
  if (uptrend && m.fromHigh <= -8 && m.fromHigh >= -25 && m.rsi14 !== null && m.rsi14 <= 38) {
    signals.push(`Pullback in an uptrend: ${m.fromHigh.toFixed(1)}% off its 52-week high while still above the 200-day average`);
    score += 3;
  }
  if (m.rsi14 !== null && m.rsi14 <= 25) {
    signals.push(`Oversold: RSI(14) ${m.rsi14.toFixed(0)}`);
    score += 2;
  }
  if ((m.change1d ?? 0) <= -7) {
    signals.push(`Sharp one-day drop: ${m.change1d!.toFixed(1)}%`);
    score += 2;
  } else if ((m.change5d ?? 0) <= -12) {
    signals.push(`Sharp 5-day drop: ${m.change5d!.toFixed(1)}%`);
    score += 1.5;
  }
  if (m.sma200 !== null && m.price < m.sma200) risks.push("Below its 200-day average (longer-term downtrend)");
  if (m.fromLow <= 3) risks.push(`Within ${m.fromLow.toFixed(1)}% of its 52-week low`);
  if (m.fromHigh < -40) risks.push(`${Math.abs(m.fromHigh).toFixed(0)}% below its 52-week high — falls this large often reflect real problems`);
  score -= risks.length * 0.75;
  if (!signals.length) return null;
  return { symbol, name, metrics: m, signals, risks, score: Math.round(score * 100) / 100 };
}

/** Strongest setups first, at most `max`, at or above `minScore`. */
export function pickSetups(all: Setup[], minScore: number, max: number): Setup[] {
  return all.filter((s) => s.score >= minScore).sort((a, b) => b.score - a.score).slice(0, max);
}

export function setupFacts(s: Setup) {
  const r = (v: number | null, d = 1) => (v === null ? null : Number(v.toFixed(d)));
  return {
    symbol: s.symbol,
    name: s.name,
    price: r(s.metrics.price, 2),
    change_1d_pct: r(s.metrics.change1d),
    change_5d_pct: r(s.metrics.change5d),
    rsi14: r(s.metrics.rsi14, 0),
    pct_from_52w_high: r(s.metrics.fromHigh),
    pct_above_52w_low: r(s.metrics.fromLow),
    above_200d_average: s.metrics.sma200 === null ? null : s.metrics.price > s.metrics.sma200,
    tracked_funds_holding: s.funds ?? null,
    insider_buyers_90d: s.insiders?.buyers ?? null,
    insider_buy_usd_90d: s.insiders?.buyValue ?? null,
    insider_sell_usd_90d: s.insiders?.sellValue ?? null,
    rule_signals: s.signals,
    rule_risks: s.risks,
  };
}
