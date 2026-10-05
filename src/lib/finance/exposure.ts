/**
 * Rule-based "market exposure": which instruments an event could plausibly
 * affect, with a written rationale. Transparent heuristics (documented in
 * docs/FINANCE.md) — never a prediction and never a trading signal.
 */
import type { EventSummary, WorldEvent } from "@/types/events";
import { INSTRUMENTS } from "./instruments";
import type { ExposureLink } from "./types";

type Ev = Pick<WorldEvent, "type" | "subtype" | "title" | "country" | "latitude" | "longitude" | "importanceScore" | "metrics" | "status">;

const GULF = new Set(["SA", "IR", "IQ", "KW", "AE", "QA", "OM", "YE", "BH"]);
const ENERGY_WORDS = /\b(oil|crude|opec|tanker|refiner|pipeline|hormuz|red sea|houthi|lng|gas field)\b/i;
const CHIP_WORDS = /\b(semiconductor|chip|tsmc|foundry|export control)\b/i;
const name = (symbol: string) => INSTRUMENTS.find((i) => i.symbol === symbol)?.name ?? symbol;
const link = (symbol: string, rationale: string): ExposureLink => ({ symbol, name: name(symbol), rationale });

interface Rule {
  when: (e: Ev) => boolean;
  links: (e: Ev) => ExposureLink[];
}

const NEWS_TYPES = new Set(["CONFLICT", "POLITICS", "PROTEST", "NEWS", "MARITIME", "TECHNOLOGY", "BUSINESS"]);
/** News-derived events only count once ≥ 2 independent publishers report them. */
const corroborated = (e: Ev) => !NEWS_TYPES.has(e.type) || e.subtype === "sec-8k" || e.status !== "UNVERIFIED";
const geopolitical = (e: Ev) => (e.type === "CONFLICT" || e.type === "POLITICS" || e.type === "PROTEST" || e.type === "MARITIME") && corroborated(e);
const inBox = (e: Ev, s: number, n: number, w: number, east: number) => e.latitude >= s && e.latitude <= n && e.longitude >= w && e.longitude <= east;
const mag = (e: Ev) => (typeof e.metrics.magnitude === "number" ? e.metrics.magnitude : 0);

export const EXPOSURE_RULES: Rule[] = [
  {
    // SEC filing → the filer's own stock
    when: (e) => e.subtype === "sec-8k" && typeof e.metrics.ticker === "string",
    links: (e) => [{ symbol: String(e.metrics.ticker), name: String(e.metrics.ticker), rationale: "The company's own regulatory filing" }],
  },
  {
    when: (e) => (geopolitical(e) && !!e.country && GULF.has(e.country)) || (corroborated(e) && ENERGY_WORDS.test(e.title)),
    links: () => [link("BZ=F", "Gulf/Red Sea supply and shipping-route risk"), link("CL=F", "Oil supply risk")],
  },
  {
    when: (e) => geopolitical(e) && (e.country === "RU" || e.country === "UA"),
    links: () => [link("ZW=F", "Black Sea grain exports"), link("NG=F", "European gas supply"), link("EURUSD=X", "European risk sentiment")],
  },
  {
    when: (e) => (geopolitical(e) && (e.country === "TW" || (e.country === "CN" && e.type === "CONFLICT"))) || (corroborated(e) && CHIP_WORDS.test(e.title)),
    links: () => [link("^TWII", "Taiwan equities / chip supply chain"), link("^IXIC", "Tech-heavy index sensitivity to chip supply")],
  },
  {
    when: (e) => (e.type === "EARTHQUAKE" && mag(e) >= 6 && e.country === "JP") || (e.subtype?.startsWith("tsunami") === true && e.country === "JP"),
    links: () => [link("^N225", "Japanese equities"), link("USDJPY=X", "Yen moves after major Japanese quakes")],
  },
  {
    when: (e) => e.type === "EARTHQUAKE" && mag(e) >= 6 && (e.country === "CL" || e.country === "PE"),
    links: () => [link("HG=F", "Copper mining concentration in Chile/Peru")],
  },
  {
    when: (e) => e.type === "EARTHQUAKE" && mag(e) >= 6 && e.country === "TW",
    links: () => [link("^TWII", "Taiwan equities / semiconductor fabs")],
  },
  {
    when: (e) => e.type === "WEATHER" && /tropical|hurricane|cyclone|storm/i.test(`${e.subtype} ${e.title}`) && inBox(e, 18, 31, -98, -80),
    links: () => [link("NG=F", "Gulf of Mexico gas production"), link("CL=F", "Gulf Coast refining")],
  },
  {
    // Dry-season burning is routine; only major fires or officially alerted hazards count.
    when: (e) =>
      e.country === "BR" &&
      ((e.type === "FIRE" && ((typeof e.metrics.frp_total_mw === "number" && e.metrics.frp_total_mw >= 5000) || typeof e.metrics.alert_level === "string")) ||
        ((e.type === "DISASTER" || e.type === "WEATHER") && typeof e.metrics.alert_level === "string")),
    links: () => [link("KC=F", "Brazilian coffee crop"), link("ZC=F", "Brazilian grain crop")],
  },
  {
    when: (e) => e.type === "AVIATION" && e.metrics.large_airport === true && (e.subtype === "ground-stop" || e.subtype === "closure" || e.subtype === "ground-delay"),
    links: () => [{ symbol: "JETS", name: "US Global Jets ETF", rationale: "US airline operations" }],
  },
  {
    when: (e) => e.type === "CONFLICT" && e.importanceScore >= 61 && corroborated(e),
    links: () => [link("GC=F", "Safe-haven demand"), link("^VIX", "Risk/volatility sentiment")],
  },
  {
    when: (e) => e.importanceScore >= 55 && corroborated(e) && e.type !== "FIRE" && !!e.country && INSTRUMENTS.some((i) => i.country === e.country),
    links: (e) => {
      const idx = INSTRUMENTS.find((i) => i.country === e.country)!;
      return [link(idx.symbol, `Main equity index of the affected country`)];
    },
  },
];

export function marketExposure(e: Ev): ExposureLink[] {
  const out = new Map<string, ExposureLink>();
  for (const r of EXPOSURE_RULES) if (r.when(e)) for (const l of r.links(e)) if (!out.has(l.symbol)) out.set(l.symbol, l);
  return [...out.values()].slice(0, 5);
}

/** Events in the window with any exposure, most important first. */
export function marketMovers(events: Array<Ev & Pick<EventSummary, "id">>, limit = 30) {
  const perSet = new Map<string, number>();
  return events
    .map((e) => ({ event: e, exposure: marketExposure(e) }))
    .filter((x) => x.exposure.length > 0)
    .sort((a, b) => b.event.importanceScore - a.event.importanceScore)
    .filter((x) => {
      // Keep the list diverse: at most two events per identical exposure set.
      const key = x.exposure.map((l) => l.symbol).sort().join(",");
      const n = (perSet.get(key) ?? 0) + 1;
      perSet.set(key, n);
      return n <= 2;
    })
    .slice(0, limit);
}
