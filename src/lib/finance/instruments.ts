/** Instruments shown in the Markets panel. Yahoo symbols unless noted. */
import type { InstrumentGroup } from "./types";

export interface Instrument {
  symbol: string;
  name: string;
  group: Exclude<InstrumentGroup, "watchlist">;
  provider: "yahoo" | "coinbase" | "treasury";
  /** ISO country whose main equity index this is (for the choropleth) */
  country?: string;
}

export const INSTRUMENTS: Instrument[] = [
  { symbol: "^GSPC", name: "S&P 500", group: "indices", provider: "yahoo", country: "US" },
  { symbol: "^IXIC", name: "Nasdaq Composite", group: "indices", provider: "yahoo" },
  { symbol: "^DJI", name: "Dow Jones", group: "indices", provider: "yahoo" },
  { symbol: "^RUT", name: "Russell 2000", group: "indices", provider: "yahoo" },
  { symbol: "^VIX", name: "VIX volatility", group: "indices", provider: "yahoo" },
  { symbol: "^GSPTSE", name: "S&P/TSX", group: "indices", provider: "yahoo", country: "CA" },
  { symbol: "^BVSP", name: "Bovespa", group: "indices", provider: "yahoo", country: "BR" },
  { symbol: "^MXX", name: "IPC Mexico", group: "indices", provider: "yahoo", country: "MX" },
  { symbol: "^FTSE", name: "FTSE 100", group: "indices", provider: "yahoo", country: "GB" },
  { symbol: "^GDAXI", name: "DAX", group: "indices", provider: "yahoo", country: "DE" },
  { symbol: "^FCHI", name: "CAC 40", group: "indices", provider: "yahoo", country: "FR" },
  { symbol: "FTSEMIB.MI", name: "FTSE MIB", group: "indices", provider: "yahoo", country: "IT" },
  { symbol: "^IBEX", name: "IBEX 35", group: "indices", provider: "yahoo", country: "ES" },
  { symbol: "^SSMI", name: "SMI", group: "indices", provider: "yahoo", country: "CH" },
  { symbol: "^AEX", name: "AEX", group: "indices", provider: "yahoo", country: "NL" },
  { symbol: "XU100.IS", name: "BIST 100", group: "indices", provider: "yahoo", country: "TR" },
  { symbol: "^TASI.SR", name: "Tadawul", group: "indices", provider: "yahoo", country: "SA" },
  { symbol: "^N225", name: "Nikkei 225", group: "indices", provider: "yahoo", country: "JP" },
  { symbol: "^HSI", name: "Hang Seng", group: "indices", provider: "yahoo", country: "HK" },
  { symbol: "000001.SS", name: "Shanghai Composite", group: "indices", provider: "yahoo", country: "CN" },
  { symbol: "^KS11", name: "KOSPI", group: "indices", provider: "yahoo", country: "KR" },
  { symbol: "^TWII", name: "TAIEX", group: "indices", provider: "yahoo", country: "TW" },
  { symbol: "^BSESN", name: "Sensex", group: "indices", provider: "yahoo", country: "IN" },
  { symbol: "^AXJO", name: "ASX 200", group: "indices", provider: "yahoo", country: "AU" },
  { symbol: "^JKSE", name: "Jakarta Composite", group: "indices", provider: "yahoo", country: "ID" },
  { symbol: "^STI", name: "Straits Times", group: "indices", provider: "yahoo", country: "SG" },

  { symbol: "DGS2", name: "US 2-year", group: "rates", provider: "treasury" },
  { symbol: "DGS10", name: "US 10-year", group: "rates", provider: "treasury" },
  { symbol: "DGS30", name: "US 30-year", group: "rates", provider: "treasury" },
  { symbol: "SPREAD2S10S", name: "2s10s spread", group: "rates", provider: "treasury" },

  { symbol: "DX-Y.NYB", name: "US dollar index", group: "fx", provider: "yahoo" },
  { symbol: "EURUSD=X", name: "EUR/USD", group: "fx", provider: "yahoo" },
  { symbol: "USDJPY=X", name: "USD/JPY", group: "fx", provider: "yahoo" },
  { symbol: "GBPUSD=X", name: "GBP/USD", group: "fx", provider: "yahoo" },
  { symbol: "USDCNY=X", name: "USD/CNY", group: "fx", provider: "yahoo" },
  { symbol: "USDINR=X", name: "USD/INR", group: "fx", provider: "yahoo" },

  { symbol: "CL=F", name: "WTI crude", group: "commodities", provider: "yahoo" },
  { symbol: "BZ=F", name: "Brent crude", group: "commodities", provider: "yahoo" },
  { symbol: "NG=F", name: "Natural gas", group: "commodities", provider: "yahoo" },
  { symbol: "GC=F", name: "Gold", group: "commodities", provider: "yahoo" },
  { symbol: "SI=F", name: "Silver", group: "commodities", provider: "yahoo" },
  { symbol: "HG=F", name: "Copper", group: "commodities", provider: "yahoo" },
  { symbol: "ZW=F", name: "Wheat", group: "commodities", provider: "yahoo" },
  { symbol: "ZC=F", name: "Corn", group: "commodities", provider: "yahoo" },
  { symbol: "KC=F", name: "Coffee", group: "commodities", provider: "yahoo" },

  { symbol: "XLK", name: "Technology", group: "sectors", provider: "yahoo" },
  { symbol: "XLF", name: "Financials", group: "sectors", provider: "yahoo" },
  { symbol: "XLE", name: "Energy", group: "sectors", provider: "yahoo" },
  { symbol: "XLV", name: "Health care", group: "sectors", provider: "yahoo" },
  { symbol: "XLY", name: "Consumer discretionary", group: "sectors", provider: "yahoo" },
  { symbol: "XLP", name: "Consumer staples", group: "sectors", provider: "yahoo" },
  { symbol: "XLI", name: "Industrials", group: "sectors", provider: "yahoo" },
  { symbol: "XLB", name: "Materials", group: "sectors", provider: "yahoo" },
  { symbol: "XLU", name: "Utilities", group: "sectors", provider: "yahoo" },
  { symbol: "XLRE", name: "Real estate", group: "sectors", provider: "yahoo" },
  { symbol: "XLC", name: "Communication services", group: "sectors", provider: "yahoo" },

  { symbol: "BTC-USD", name: "Bitcoin", group: "crypto", provider: "coinbase" },
  { symbol: "ETH-USD", name: "Ether", group: "crypto", provider: "coinbase" },
  { symbol: "SOL-USD", name: "Solana", group: "crypto", provider: "coinbase" },
];

export const SYMBOL_PATTERN = /^[A-Za-z0-9.^=\-]{1,15}$/;
