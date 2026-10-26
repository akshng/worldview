/**
 * Insider trading from SEC Form 4 filings. Officers, directors and 10% owners
 * must report trades within two business days. Open-market purchases (code P)
 * are the meaningful signal; sales (S) are often routine (taxes, diversification,
 * pre-scheduled 10b5-1 plans). Other codes (grants, option exercises, gifts) are ignored.
 */

export interface InsiderTrade {
  owner: string;
  role: string;
  date: string;
  code: "P" | "S";
  shares: number;
  price: number | null;
  value: number | null;
  filed: string;
  filingUrl: string;
}

export interface InsiderSummary {
  ticker: string;
  cik: string;
  days: number;
  trades: InsiderTrade[];
  buyers: number;
  buyValue: number;
  sellers: number;
  sellValue: number;
  /** two or more different insiders bought on the open market in the window */
  clusterBuy: boolean;
  asOf: string;
}

const unxml = (s: string) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'").trim();

/** Text of `<tag>` (or of its `<value>` child). */
function field(xml: string, tag: string): string | null {
  const m = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  if (!m) return null;
  const v = m[1].match(/<value>([\s\S]*?)<\/value>/);
  return unxml(v ? v[1] : m[1]) || null;
}

function role(xml: string): string {
  if (field(xml, "isOfficer") === "1" || field(xml, "isOfficer") === "true") return field(xml, "officerTitle") ?? "Officer";
  if (field(xml, "isDirector") === "1" || field(xml, "isDirector") === "true") return "Director";
  if (field(xml, "isTenPercentOwner") === "1" || field(xml, "isTenPercentOwner") === "true") return "10% owner";
  return field(xml, "otherText") ?? "Insider";
}

/** Open-market buys and sells in one Form 4 document. */
export function parseForm4(xml: string, filed: string, filingUrl: string): InsiderTrade[] {
  const ownerBlock = xml.match(/<reportingOwner>([\s\S]*?)<\/reportingOwner>/)?.[1] ?? "";
  const owner = field(ownerBlock, "rptOwnerName") ?? "Unknown";
  const r = role(ownerBlock);
  const out: InsiderTrade[] = [];
  for (const m of xml.matchAll(/<nonDerivativeTransaction>([\s\S]*?)<\/nonDerivativeTransaction>/g)) {
    const t = m[1];
    const code = field(t, "transactionCode");
    if (code !== "P" && code !== "S") continue;
    const shares = Number(field(t, "transactionShares"));
    if (!Number.isFinite(shares) || shares <= 0) continue;
    const p = Number(field(t, "transactionPricePerShare"));
    const price = Number.isFinite(p) && p > 0 ? p : null;
    out.push({ owner, role: r, date: field(t, "transactionDate")?.slice(0, 10) ?? filed, code, shares, price, value: price === null ? null : Math.round(shares * price), filed, filingUrl });
  }
  return out;
}

export function summarizeInsiders(ticker: string, cik: string, trades: InsiderTrade[], days: number, now = Date.now()): InsiderSummary {
  const cutoff = now - days * 86_400_000;
  const recent = trades.filter((t) => Date.parse(t.date) >= cutoff).sort((a, b) => b.date.localeCompare(a.date));
  const buys = recent.filter((t) => t.code === "P");
  const sells = recent.filter((t) => t.code === "S");
  const sum = (xs: InsiderTrade[]) => xs.reduce((a, t) => a + (t.value ?? 0), 0);
  const buyers = new Set(buys.map((t) => t.owner)).size;
  return {
    ticker,
    cik,
    days,
    trades: recent,
    buyers,
    buyValue: sum(buys),
    sellers: new Set(sells.map((t) => t.owner)).size,
    sellValue: sum(sells),
    clusterBuy: buyers >= 2,
    asOf: new Date(now).toISOString(),
  };
}
