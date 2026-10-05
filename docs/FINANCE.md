# Finance features

WorldView connects world events to markets so you can see **what is moving and what is happening at the same time**. Everything here is information, not advice: nothing recommends trades, sets price targets or predicts prices.

## What's included

| Feature | Where | Data |
| --- | --- | --- |
| Cross-asset snapshot: 26 equity indices, US Treasury 2Y/10Y/30Y + 2s10s, 12 FX pairs, 15 commodities, 8 cryptocurrencies | Top bar → **Markets** | Yahoo Finance chart endpoint (unofficial, delayed), U.S. Treasury yield-curve CSV, Coinbase Exchange public candles |
| Watchlist (any Yahoo symbol: `MSFT`, `^GSPC`, `EURUSD=X`, `GC=F`) | Markets panel; saved in this browser | Same as above |
| SEC 8-K material filings on the map, linked to the filer's ticker | Map (Business layer), watchlist "Filings for your tickers" | SEC EDGAR |
| **Market exposure** for an event (which instruments it could plausibly affect, with live change) | Event details panel | Rule-based (below) |
| **World events with market exposure** (last 24 h) | Markets panel | Rule-based |
| **Markets map mode**: countries coloured by their main index's daily % change | Sidebar → View mode → Markets | Yahoo Finance |
| **AI market wrap**: describes today's moves from the numbers shown, mentions coinciding events | Markets panel | Local on-device model (or hosted, if configured) |

| **Instrument view** (click any tile/chip): price chart 1D–5Y with crosshair, day & 52-week range; for US-listed companies: industry, HQ, latest-quarter revenue / net income / diluted EPS / operating cash flow vs the same quarter a year earlier, insider (Form 4) filing count, recent filings, related WorldView events | Markets panel, exposure chips, watchlist | Yahoo Finance (prices), SEC EDGAR submissions + XBRL company facts |
| **US sector performance** (11 SPDR sector ETFs) as a sorted diverging bar chart | Markets panel | Yahoo Finance |
| **Treasury yield curve**, latest vs one month earlier | Markets panel | U.S. Treasury |
| **Economic calendar**: BLS (jobs, CPI, PPI, JOLTS…), BEA (GDP, PCE, trade…), Treasury auctions — scheduled dates only, no forecasts | Markets panel | BLS ICS, BEA release dates, Treasury Fiscal Data |
| **Move since event**: change of each linked instrument from the price at the event time to now (≤ 5 trading days) | Event details → Market exposure | Yahoo Finance hourly |
| **US economy dashboard**: CPI, core CPI, core PCE, 10-yr breakeven; unemployment, payrolls change, jobless claims, Sahm-rule recession indicator; real GDP growth, retail sales, industrial production; fed funds, 10y−2y and 10y−3m spreads, high-yield spread, financial stress index; M2, Fed balance sheet; 30-yr mortgage, housing starts; consumer sentiment; **global**: ECB deposit rate, UK and Japan overnight rates, euro-area inflation, German / UK / Japanese 10-year yields; **fiscal**: US national debt (daily), fiscal-year-to-date deficit; **crypto market**: total market cap, Bitcoin dominance, DeFi value locked, stablecoin supply; crypto Fear & Greed. Latest value, change vs previous release, period date, sparkline, link to the full series | Markets panel | FRED (St. Louis Fed, keyless `fredgraph.csv`), U.S. Treasury Fiscal Data, CoinGecko, DefiLlama, alternative.me |
| **Bonds & credit** (Treasury 1–3 / 7–10 / 20+ yr, TIPS, IG and high-yield corporate, EM and muni bond ETFs) and **volatility** (VIX 9-day / 3-month, VVIX, oil OVX, gold GVZ) | Markets panel | Yahoo Finance |
| **Crypto top 20** by market cap: price, 24 h and 7 d change, market cap, 7-day sparkline | Markets panel | CoinGecko (cached 5 min) |
| **US stock movers**: today's top gainers, losers and most active US stocks; click for the instrument view | Markets panel | Yahoo Finance predefined screeners (unofficial, delayed; cached 5 min) |
| **In-app price alerts** (above/below), checked every 3 minutes while the app is open; fire once per crossing | Instrument view; toasts | Delayed quotes |

All upstream calls are server-side and cached (quotes 3 min, Treasury 6 h, macro 6 h); clients share the cache. Macro changes are shown in neutral ink with an arrow — a rising number isn't inherently good or bad.

## Exposure rules (`src/lib/finance/exposure.ts`)

Transparent heuristics, each with a written rationale shown in the UI. News-derived events only qualify once **≥ 2 independent publishers** report them (status not `UNVERIFIED`).

| Event | Instruments | Rationale |
| --- | --- | --- |
| SEC 8-K material filing | the filer's ticker | the company's own filing |
| Corroborated conflict/politics in the Gulf states, or energy terms (oil, OPEC, Hormuz, Red Sea, Houthi, tanker…) | Brent, WTI | supply / shipping-route risk |
| Corroborated conflict/politics in Russia/Ukraine | Wheat, natural gas, EUR/USD | Black Sea grain, European gas |
| Taiwan tensions, China conflict, chip/export-control terms | TAIEX, Nasdaq | semiconductor supply chain |
| M6+ earthquake or tsunami message in Japan | Nikkei 225, USD/JPY | — |
| M6+ earthquake in Chile/Peru | Copper | mining concentration |
| Tropical cyclone in the Gulf of Mexico | Natural gas, WTI | production & refining |
| Major Brazilian fire (≥ 5,000 MW) or alerted hazard | Coffee, corn | crops (routine dry-season burning excluded) |
| Ground stop / closure / ground delay at a large US airport | US Global Jets ETF | airline operations |
| Corroborated conflict with importance ≥ 61 | Gold, VIX | safe haven / volatility |
| Corroborated event with importance ≥ 55 in a country with a tracked index | that index | — |

The movers list shows at most two events per identical set of instruments so one theme can't flood it.

## Colour

Up/down uses a validated diverging pair on the dark surface — up `#3f8de8` (blue), down `#e5534b` (red), gray midpoint — and always pairs colour with ▲/▼ and a signed number (colour-blind safe; red/green is avoided on purpose).

## Data caveats

- Yahoo Finance's chart endpoint is **unofficial and delayed**; it can change or rate-limit without notice. Quotes are labelled as delayed; failures show "n/a" per tile, never stale numbers presented as live.
- Index "daily change" is vs the previous close; closed markets show the last session.
- Treasury yields update once per business day.
