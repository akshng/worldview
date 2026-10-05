import type { Quote } from "./types";

export const UP = "#3f8de8";
export const DOWN = "#e5534b";

export function formatPrice(q: Pick<Quote, "price" | "unit" | "group" | "symbol">): string {
  if (q.price === null) return "—";
  if (q.unit === "percent") return `${q.price.toFixed(2)}%`;
  const digits = q.group === "fx" && !q.symbol.startsWith("DX") ? 4 : Math.abs(q.price) >= 1000 ? 0 : 2;
  return q.price.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** Signed change: percent for prices, basis points for rates. */
export function formatChange(q: Pick<Quote, "change" | "changePct" | "unit">): { text: string; dir: 1 | -1 | 0 } {
  if (q.unit === "percent") {
    if (q.change === null) return { text: "—", dir: 0 };
    const bp = Math.round(q.change * 100);
    return { text: `${bp > 0 ? "+" : ""}${bp} bp`, dir: bp > 0 ? 1 : bp < 0 ? -1 : 0 };
  }
  if (q.changePct === null) return { text: "—", dir: 0 };
  const v = q.changePct;
  return { text: `${v > 0 ? "+" : ""}${v.toFixed(2)}%`, dir: v > 0.005 ? 1 : v < -0.005 ? -1 : 0 };
}
