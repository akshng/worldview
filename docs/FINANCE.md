# Finance features

WorldView connects world events to markets so you can see **what is moving and what is happening at the same time**. Everything here is information, not advice: nothing recommends trades, sets price targets or predicts prices.

## What's included

| Feature | Where | Data |
| --- | --- | --- |
| Cross-asset snapshot: 45 equity indices (40 countries on the markets map), US Treasury 2Y/10Y/30Y + 2s10s, 20 FX pairs incl. emerging markets, 15 commodities, 8 cryptocurrencies | Top bar → **Markets** | Yahoo Finance chart endpoint (unofficial, delayed), U.S. Treasury yield-curve CSV, Coinbase Exchange public candles |
| **Search any instrument worldwide** (stocks on every exchange Yahoo covers, ETFs, indices, futures, currencies, crypto, funds) with type, exchange and sector; open it or add it to the watchlist | Markets panel | Yahoo Finance search (unofficial; cached 1 h per query) |
| Watchlist (any Yahoo symbol: `MSFT`, `7203.T`, `^GSPC`, `EURUSD=X`, `GC=F`) | Markets panel; saved in this browser | Same as above |
| SEC 8-K material filings on the map, linked to the filer's ticker | Map (Business layer), watchlist "Filings for your tickers" | SEC EDGAR |
| **Market exposure** for an event (which instruments it could plausibly affect, with live change) | Event details panel | Rule-based (below) |
| **World events with market exposure** (last 24 h) | Markets panel | Rule-based |
| **Markets map mode**: countries coloured by their main index's daily % change | Sidebar → View mode → Markets | Yahoo Finance |
| **AI market wrap**: describes today's moves from the numbers shown, mentions coinciding events | Markets panel | Local on-device model (or hosted, if configured) |

| **Instrument view** (click any tile/chip): price chart 1D–5Y with crosshair, day & 52-week range; for US-listed companies: industry, HQ, latest-quarter revenue / net income / diluted EPS / operating cash flow vs the same quarter a year earlier (plus R&D expense), quarterly revenue for the last 12 quarters (fourth quarters derived as the 10-K annual total minus the three reported quarters, drawn dashed), latest balance sheet (total assets, liabilities, equity, cash, long-term debt, shares outstanding), insider (Form 4) filing count, recent filings, related WorldView events; **dividends** for any payer: last 5 years of ex-dates and amounts, trailing-12-month total, payments per year and trailing yield | Markets panel, exposure chips, watchlist | Yahoo Finance (prices; dividends via the chart endpoint's `events=div`, cached 12 h), SEC EDGAR submissions + XBRL company facts |
| **Earnings released (last 7 days)**: companies that furnished a results press release on an 8-K under Item 2.02, with ticker (opens the instrument view), filing date and a link to the filing; filterable | Markets panel | SEC EDGAR full-text search (`efts.sec.gov`, cached 1 h) |
| **Futures curves (term structure)**: WTI and Brent crude, natural gas (12 successive months), gold (6 listed months), and the VIX curve (9-day / 30-day / 3-, 6-month / 1-year indices); first-to-last slope labelled contango / backwardation / flat (±1%) | Markets panel | Yahoo Finance chart endpoint for individual contracts such as `CLZ26.NYM` (unofficial, delayed; expired or unlisted months are skipped, so the chart's x axis is months ahead and gaps stay visible); Cboe VIX indices — Yahoo doesn't serve VIX futures (cached 30 min) |
| **US sector performance** (11 SPDR sector ETFs) as a sorted diverging bar chart | Markets panel | Yahoo Finance |
| **Treasury yield curve**, latest vs one month earlier | Markets panel | U.S. Treasury |
| **Economic calendar**: BLS (jobs, CPI, PPI, JOLTS…), BEA (GDP, PCE, trade…), Treasury auctions — scheduled dates only, no forecasts | Markets panel | BLS ICS, BEA release dates, Treasury Fiscal Data |
| **Move since event**: change of each linked instrument from the price at the event time to now (≤ 5 trading days) | Event details → Market exposure | Yahoo Finance hourly |
| **US economy dashboard**: CPI, core CPI, core PCE, 10-yr breakeven; unemployment, payrolls change, jobless claims, Sahm-rule recession indicator; real GDP growth, retail sales, industrial production; fed funds, SOFR, 10y−2y and 10y−3m spreads, high-yield spread, financial stress index; M2, Fed balance sheet, bank reserves, Fed overnight reverse repo, Treasury cash balance (TGA, daily from the Daily Treasury Statement); 30-yr mortgage, housing starts; consumer sentiment; producer prices, gasoline price, job openings, participation rate, vehicle sales, Case-Shiller home prices, credit-card delinquency; **global**: ECB deposit and main refinancing rates, SONIA, UK / Japan / Canada / Australia / Korea overnight rates, euro-area inflation, 10-year yields for Germany, UK, Japan, France, Italy, Spain, Switzerland, Canada, Australia, Korea, Mexico and South Africa, the Italy − Germany 10-year spread, the Fed's broad trade-weighted dollar index (OECD yields are monthly averages); **fiscal**: US national debt (daily), fiscal-year-to-date deficit; **crypto market**: total market cap, Bitcoin dominance, DeFi value locked, stablecoin supply; crypto Fear & Greed. Latest value, change vs previous release, period date, sparkline, link to the full series | Markets panel | FRED (St. Louis Fed, keyless `fredgraph.csv`), U.S. Treasury Fiscal Data, CoinGecko, DefiLlama, alternative.me |
| **Bonds & credit** (Treasury 1–3 / 7–10 / 20+ yr, TIPS, IG and high-yield corporate, EM and muni bond ETFs) and **volatility** (VIX 9-day / 3-month, VVIX, oil OVX, gold GVZ) | Markets panel | Yahoo Finance |
| **Prediction markets**: busiest open events in economics, financials, politics & elections, and world & science, with the leading outcomes' implied probabilities and daily change | Markets panel | Kalshi public market-data API (CFTC-regulated; sports and entertainment excluded; cached 15 min) |
| **New registration statements** (S-1 / F-1, last 30 days), filterable to companies without a ticker (likely IPOs) | Markets panel | SEC EDGAR full-text search (cached 3 h) |
| **Treasury auction results**: latest 10 auctions with rate, bid-to-cover and indirect-bidder share | Markets panel | U.S. Treasury Fiscal Data (cached 6 h) |
| **Futures positioning**: speculators' net long/short for 19 futures (S&P, Nasdaq, VIX, 2y/10y/bond, dollar, euro, yen, pound, crude, natural gas, gold, silver, copper, corn, soybeans, wheat, bitcoin) as % of open interest, weekly change, 3-year percentile, 1-year history | Markets panel | CFTC Commitments of Traders (legacy futures-only, public Socrata API; cached 6 h) |
| **Short sale volume**: daily share of FINRA-reported volume sold short, last 10 sessions | Instrument view (US-listed symbols) | FINRA Reg SHO daily files |
| **Crypto top 20** by market cap: price, 24 h and 7 d change, market cap, 7-day sparkline | Markets panel | CoinGecko (cached 5 min) |
| **US stock movers**: today's top gainers, losers and most active US stocks; click for the instrument view | Markets panel | Yahoo Finance predefined screeners (unofficial, delayed; cached 5 min) |
| **10-K analysis** ("Analyze" on any 10-K in the instrument view): a computed table of the fiscal year vs the prior year as reported in that filing — revenue, gross/operating/net income and margins, diluted EPS, operating cash flow, capex, free cash flow (OCF − capex), R&D and R&D % of revenue, cash, total debt (long-term debt incl. current portion + commercial paper / short-term borrowings), equity, debt/equity, diluted share count — with YoY change (margins in percentage points); plus an **AI analysis** (business summary, key financial changes, top risks, MD&A / outlook highlights, notable changes, questions an investor might ask) written only from those figures and Items 1, 1A, 7 and 7A of the filing. Without `WORLDVIEW_CONTACT` it is **financials-only** (SEC's archive rejects automated clients without a contact email), and the text-derived AI sections stay empty. AI off → figures only. Each finished analysis is cached in `DATA_DIR/filings/<accession>.json` | Instrument view → Annual reports | SEC XBRL company facts (`data.sec.gov`), the 10-K document (`www.sec.gov/Archives`, contact required); local or hosted AI |
| **Fund holdings (13F)**: 27 tracked managers (Berkshire, Bridgewater, Pershing Square, Scion, Renaissance, Citadel, Appaloosa, Duquesne, Tiger Global, ARK, Soros, Third Point, BlackRock, Two Sigma, Millennium, D. E. Shaw, Elliott, Baupost, Lone Pine, Coatue, Viking, Icahn, Gates Foundation Trust, Altimeter, Trian, ValueAct, Himalaya) with report quarter, 13F value and position count; each opens a holdings table — weight, value, shares, change vs the prior quarter (▲/▼ % of shares, NEW, sold-out list), filter / sort, link to the filing; holdings with a ticker open the instrument view. The instrument view shows **Held by tracked funds** | Markets panel; instrument view | SEC EDGAR Form 13F-HR information tables (needs `WORLDVIEW_CONTACT`; see below) |
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

## 13F institutional holdings (`src/lib/finance/thirteenf.ts`, `thirteenf-service.ts`)

**API**

| Endpoint | Returns |
| --- | --- |
| `GET /api/markets/13f` | Tracked managers: report period, filing date, total 13F value, position count, top 3 holdings. Managers still loading have `status: "loading"` and are counted in `pending` — the UI polls every 5 s until it is 0 |
| `GET /api/markets/13f/:cik?limit=250` | One manager's latest 13F: holdings by value (weight %, value, shares, put/call, QoQ change, ticker), up to 100 sold-out positions, change counts, filing links, value unit |
| `GET /api/markets/13f/by-ticker/:ticker` | Tracked managers whose latest 13F holds that ticker (value, weight, rank, change) — used by the instrument view |

All three return 503 when `WORLDVIEW_CONTACT` is unset (www.sec.gov/Archives rejects clients without a contact in the User-Agent).

**Pipeline.** `data.sec.gov/submissions/CIK##########.json` → the two newest report periods among `13F-HR` / `13F-HR/A` filings → for each filing `Archives/edgar/data/<cik>/<accession>/index.json`, `primary_doc.xml` (cover page: period, amendment type) and the information-table XML (the largest other `.xml` in the filing). Each `infoTable` gives `nameOfIssuer`, `titleOfClass`, `cusip`, `value`, `sshPrnamt` / `sshPrnamtType` (SH or PRN), `putCall`, `investmentDiscretion`; namespace prefixes are tolerated.

- **Amendments.** Per period the newest `RESTATEMENT` amendment replaces the original; `NEW HOLDINGS` amendments filed after the base filing are added to it; other amendments are ignored. (Citadel's Q2 2026 report, for example, is a restatement.)
- **Value units.** Filings made **on or after 3 January 2023** report `value` in **dollars** (SEC's amended Form 13F); earlier filings in **thousands** (multiplied by 1,000). The filing date decides; without one, the report period does (periods ending 2022-12-31 or later). A sanity check on the median implied price per share (value ÷ shares over common-share rows) catches filers that used the other unit: below 1 in a "dollars" filing ⇒ thousands, above 5 in a "thousands" filing ⇒ dollars. The unit and how it was decided are returned per filing.
- **Aggregation.** One position per CUSIP **and** put/call: rows split across other included managers or discretion types are summed; calls and puts stay separate from the shares (their value is the underlying's, not the premium). Weight = position value ÷ total reported value.
- **Quarter-over-quarter.** By share count (values move with prices): `new` (not in the prior 13F), `added`, `reduced`, `unchanged`, plus the sold-out list (in the prior 13F, not in this one) and the share-count change and %.
- **CUSIP → ticker.** There's no keyless official CUSIP map, so tickers are a **best-effort name match** against SEC `company_tickers.json`: names are normalized (case, punctuation, `/DE/`-style tags, legal suffixes, common CUSIP abbreviations such as PETE / FINL / HLDGS), then matched exactly, without spaces, or word-by-word allowing abbreviations and truncation (`GENERAL MTRS` ~ `GENERAL MOTORS`; 13F names are cut at ~28 characters). No ticker is given when the name matches several registrants, for multi-series trusts (iShares, SPDR), debt / warrants / preferreds, or when a company lists several share classes and the class can't be told from the title (BRK-A / BRK-B and FOXA are resolved; Alphabet's two classes are resolved from their CUSIPs). The UI labels these tickers "matched by name"; about 80% of a broad portfolio (D. E. Shaw) matches.

**Caching and fair access.** All SEC requests share one throttle (≤ 8 per second, 2 retries on 429/503). Parsed filings are immutable and stored forever as `DATA_DIR/13f/filing-<accession>.json`; submissions and `company_tickers.json` are cached in memory and in `DATA_DIR/13f/` for 24 h; computed holdings are kept in memory for 24 h and served stale while refreshing. At most three managers load at once (BlackRock's information table is ~23 MB). A cold start fetches ~150 documents, roughly 1–2 minutes; after that, nothing until a cache expires.

**Not covered.** Vanguard (its recent 13F filings are crowded out of the submissions index by other forms, and the table is enormous) and Greenlight Capital (no 13F under its CIK since February 2024). Scion's latest 13F is for Q3 2025 — the firm stopped filing after that.

**Caveats shown in the UI.** 13Fs are filed up to 45 days after quarter end; only long positions in 13(f) securities (US-listed stocks, some ETFs, convertibles, listed options) are reported — no shorts, cash, bonds or non-US holdings; confidential positions may be omitted; information only, not investment advice.

## Data caveats

- Yahoo Finance's chart endpoint is **unofficial and delayed**; it can change or rate-limit without notice. Quotes are labelled as delayed; failures show "n/a" per tile, never stale numbers presented as live.
- Index "daily change" is vs the previous close; closed markets show the last session.
- Treasury yields update once per business day.

## Not included (needs a key or isn't freely available)

- **Analyst ratings and price targets.** Yahoo serves these only behind a session token, and WorldView doesn't work around access controls. A free-tier key from a provider such as Finnhub would enable them as an optional, server-side integration.
- **Company fundamentals outside the US.** SEC EDGAR covers US filers only; foreign listings show prices and charts.
- **Market-wide insider trades.** SEC's "current filings" feed refuses automated clients.
- **VIX futures prices.** Yahoo returns 404 for VIX contract symbols (e.g. `VXZ26.CBF`); the VIX curve uses Cboe's constant-maturity indices instead.
- **India and Brazil 10-year yields.** The OECD series on FRED (`IRLTLT01INM156N`, `IRLTLT01BRM156N`) return 404. Some OECD policy-rate series (Canada central-bank rate, Switzerland overnight, India discount rate) stopped updating in 2022–2024 and are left out in favour of current interbank-rate series.
- **Earnings estimates, surprises and dates of upcoming reports.** No keyless source; the earnings list shows only releases already filed with the SEC.

