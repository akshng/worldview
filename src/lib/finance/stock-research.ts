/**
 * One-stock research packet for the AI analyst: why it moved (headlines, recent
 * filings, an earnings report), how the business is doing (revenue and profit vs a
 * year earlier), insider trades and fund ownership. Everything is fetched from
 * free public sources and cached; each part fails soft.
 */
import "server-only";
import { companyProfile } from "./company";
import { stockHeadlines, type Headline } from "./stock-news";
import { suggestTake, type Take } from "./research-take";

export interface StockResearch {
  ticker: string;
  company: string | null;
  industry: string | null;
  headlines: Array<Pick<Headline, "title" | "source" | "published">>;
  recentFilings: Array<{ form: string; filed: string; what: string }>;
  earnings: string | null;
  fundamentals: Array<{ metric: string; latest: string; vsYearAgo: string | null; period: string }>;
  insiders: { buyers: number; buyValue: number; sellers: number; sellValue: number; notable: string[] } | null;
  trackedFundsHolding: number | null;
  upcomingEarnings: string | null;
  take: Take;
}

/** "VALERO ENERGY CORP/TX" → "Valero Energy"; "Coca-Cola Company (The)" → "Coca-Cola". */
export function searchName(name: string): string {
  let s = name.replace(/\/[A-Z]{2,3}\/?$/i, "").replace(/\s*\(the\)$/i, "").trim();
  for (let i = 0; i < 3; i++) s = s.replace(/[,.]?\s+(inc|corp|corporation|co|company|ltd|limited|plc|holdings?|group|n\.?v|s\.?a|l\.?p)\.?$/i, "").trim();
  return s === s.toUpperCase() ? s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : s;
}
const money = (v: number) => (Math.abs(v) >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : Math.abs(v) >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : `$${Math.round(v).toLocaleString("en-US")}`);
const within = <T,>(p: Promise<T>, ms: number, fallback: T) => Promise.race([p.catch(() => fallback), new Promise<T>((r) => setTimeout(() => r(fallback), ms))]);

function weekdaysAhead(n: number): string[] {
  const out: string[] = [];
  const d = new Date();
  while (out.length < n) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

function weekdaysBack(n: number): string[] {
  const out: string[] = [];
  const d = new Date();
  while (out.length < n) {
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return out;
}

export async function researchStock(ticker: string, nameHint?: string): Promise<StockResearch> {
  const t = ticker.toUpperCase();
  const profile = await within(companyProfile(t), 20_000, null);
  const name = searchName(nameHint || profile?.name || t);
  const cutoff = Date.now() - 14 * 86_400_000;

  const [headlines, insiders, holders, earnings] = await Promise.all([
    within(
      stockHeadlines(name).then(async (h) => (h.length >= 2 ? h : [...h, ...(await stockHeadlines(`${t} stock`).catch(() => []))])),
      15_000,
      [] as Headline[],
    ),
    within(import("./insiders-service").then((m) => m.insiderActivity(t)), 20_000, null),
    within(import("./thirteenf-service").then((m) => m.holdersOf(t)), 8_000, null),
    within(
      import("./earnings-calendar").then(async (m) => {
        for (const day of weekdaysBack(3)) {
          const row = (await m.earningsOn(day).catch(() => [])).find((r) => r.symbol === t);
          if (row) return `Reported earnings on ${day} (${row.when})${row.epsForecast ? `; EPS forecast was ${row.epsForecast}` : ""}${row.lastYearEps ? `, year-ago EPS ${row.lastYearEps}` : ""}.`;
        }
        // An earnings press release filed as an 8-K in the last week counts too.
        const pr = (profile?.filings ?? []).find((f) => f.form === "8-K" && /earnings|results/i.test(f.description) && Date.now() - Date.parse(f.filed) < 7 * 86_400_000);
        return pr ? `Reported earnings on ${pr.filed} (8-K: ${pr.description.toLowerCase()}).` : null;
      }),
      12_000,
      null,
    ),
  ]);

  const upcomingEarnings = await within(
    import("./earnings-calendar").then(async (m) => {
        for (const day of weekdaysAhead(7)) {
          const row = (await m.earningsOn(day).catch(() => [])).find((r) => r.symbol === t);
          if (row) return `Reports earnings on ${day} (${row.when}).`;
        }
        return null;
      }),
    15_000,
    null,
  );

  const fundamentals = (profile?.fundamentals ?? [])
    .filter((f) => /revenue|net income|operating income|eps|earnings per share|cash from operations|free cash/i.test(f.label))
    .slice(0, 4)
    .map((f) => ({
      metric: f.label,
      latest: f.unit === "USD" ? money(f.value) : `${f.value}`,
      vsYearAgo: f.priorValue ? `${f.value >= f.priorValue ? "+" : ""}${(((f.value - f.priorValue) / Math.abs(f.priorValue)) * 100).toFixed(0)}% vs a year earlier` : null,
      period: f.period,
    }));

  const growthOf = (re: RegExp) => {
    const f = (profile?.fundamentals ?? []).find((x) => re.test(x.label) && x.priorValue);
    return f ? ((f.value - f.priorValue!) / Math.abs(f.priorValue!)) * 100 : null;
  };
  const take = suggestTake({
    headlines: headlines.map((h) => h.title),
    earningsRecent: earnings,
    earningsUpcoming: upcomingEarnings,
    growth: growthOf(/revenue/i) ?? growthOf(/net income/i),
    insiderBuyers: insiders?.buyers ?? 0,
    insiderBuyValue: insiders?.buyValue ?? 0,
  });

  return {
    ticker: t,
    upcomingEarnings,
    take,
    company: profile?.name ?? null,
    industry: profile?.industry ?? null,
    headlines: headlines.slice(0, 6).map((h) => ({ title: h.title, source: h.source, published: h.published?.slice(0, 10) ?? null })),
    recentFilings: (profile?.filings ?? []).filter((f) => Date.parse(f.filed) >= cutoff).slice(0, 4).map((f) => ({ form: f.form, filed: f.filed, what: f.description })),
    earnings,
    fundamentals,
    insiders: insiders
      ? {
          buyers: insiders.buyers,
          buyValue: insiders.buyValue,
          sellers: insiders.sellers,
          sellValue: insiders.sellValue,
          notable: insiders.trades.slice(0, 3).map((x) => `${x.date} ${x.owner} (${x.role}) ${x.code === "P" ? "bought" : "sold"} ${x.value ? money(x.value) : `${x.shares} shares`}`),
        }
      : null,
    trackedFundsHolding: holders ? holders.holders.filter((h) => !h.putCall).length : null,
  };
}
