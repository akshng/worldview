import { countryIndexChanges } from "@/lib/finance/service";
import type { LiveLayerProvider } from "../types";

export interface MarketsLayerData {
  countries: Array<{ country: string; symbol: string; name: string; changePct: number | null; asOf: string | null }>;
}

/** Daily % change of each country's main equity index (markets choropleth). */
export const marketsLayer: LiveLayerProvider<MarketsLayerData> = {
  id: "markets",
  name: "Equity indices by country",
  description: "Daily change of each country's main stock index (delayed, unofficial Yahoo Finance data).",
  homepage: "https://finance.yahoo.com/",
  attribution: "Quotes: Yahoo Finance (unofficial, delayed) — not investment advice",
  ttlMs: 3 * 60_000,
  async load(ctx) {
    const countries = await countryIndexChanges();
    return {
      layerId: "markets",
      observedAt: new Date(ctx.now).toISOString(),
      retrievedAt: new Date(ctx.now).toISOString(),
      count: countries.filter((c) => c.changePct !== null).length,
      data: { countries },
      attribution: this.attribution,
      notes: ["Each country shows its main index's change vs the previous close. Markets may be closed — see each index's time."],
    };
  },
};
