/** Market data types (client + server safe). */
export type InstrumentGroup = "indices" | "sectors" | "rates" | "fx" | "bonds" | "volatility" | "commodities" | "crypto" | "watchlist";

export interface Quote {
  symbol: string;
  name: string;
  group: InstrumentGroup;
  price: number | null;
  /** Absolute change vs previous close (for rates: percentage points) */
  change: number | null;
  /** Percent change vs previous close (null for rates) */
  changePct: number | null;
  unit: "price" | "percent";
  currency: string | null;
  asOf: string | null;
  /** Recent closes for a sparkline (oldest → newest) */
  spark: number[];
  source: string;
  /** True when the source is delayed/unofficial (shown in the UI) */
  delayed: boolean;
  error?: string;
}

export interface MarketSnapshot {
  generatedAt: string;
  groups: Record<Exclude<InstrumentGroup, "watchlist">, Quote[]>;
  disclaimer: string;
}

export interface ExposureLink {
  symbol: string;
  name: string;
  rationale: string;
}
