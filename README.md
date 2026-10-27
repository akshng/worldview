# WorldView

**See what is happening in the world right now.**

Created by **[akshng](https://github.com/akshng)** · Open source under the [Apache License 2.0](LICENSE), built for students to learn from and use.

WorldView is a local-first global intelligence dashboard: an interactive 3D globe of real-world events — earthquakes, disasters, severe weather, satellite fire detections, conflict/protest reporting, rocket launches — ingested from legitimate public feeds, normalised into one event model, deduplicated, scored, and traceable to their sources.

> The working name lives in one place: `NEXT_PUBLIC_APP_NAME` (default `WorldView`, see `src/lib/config/app.ts`).

## Principles

1. **Accuracy and traceability first.** Every event links to the records that support it. Nothing is invented.
2. **Facts and AI are separate.** `summary` holds facts derived from source data; `aiInterpretation` is a separate, clearly labelled field and is never shown as fact.
3. **Honest status.** An event is only `CONFIRMED` when an authoritative source publishes a final record (e.g. a USGS-reviewed solution).
4. **No fake data in live mode.** Demo mode exists for offline development, is unmistakably labelled, and uses a separate store.

## AI without accounts

AI features (event interpretation, briefing summary, natural-language search) run **on your computer** by default: an open-weights model (Google's Gemma 4 E2B, Apache-2.0, built for laptops and phones) via llama.cpp (Metal on Apple Silicon). No account, no API key, nothing leaves the machine. On an M4 it writes the morning briefing in ~25 s, about 2.5× faster than the Qwen3-4B it replaced, so the AI is busy (and drawing power) for less than half the time. The model (≈3.1 GB) downloads once from Hugging Face on first use, or ahead of time:

```bash
npm run ai:setup
```

## Quick start

Requirements: Node.js 20.9+ (tested on Node 24), npm.

```bash
npm install
```

```bash
npm run dev
```

Open http://localhost:3000. No API keys are required: all V1 sources are keyless public feeds. The first ingestion runs within a few seconds; the globe fills in as sources report.

Optional configuration:

```bash
cp .env.example .env.local
```

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_APP_NAME` | `WorldView` | Product name in the UI |
| `WORLDVIEW_DATA_MODE` | `live` | `live` = real public data; `demo` = clearly-labelled simulated events only |
| `INGESTION_ENABLED` | `true` | Disable upstream polling (serve stored data only) |
| `DATA_DIR` | `.data` | Local store location (`live-store.json` / `demo-store.json`) |
| `RETENTION_DAYS` | `8` | How long events are kept |
| `WORLDVIEW_CONTACT` | — | Contact appended to the User-Agent (api.weather.gov requests one) |
| `ADMIN_TOKEN` | — | If set, `POST /api/ingest/:source` and `POST /api/ai/unload` require `Authorization: Bearer <token>`; otherwise only localhost may trigger |
| `NASA_FIRMS_MAP_KEY` | — | Optional FIRMS API key; without it the public 24 h VIIRS file is used |
| `OPENSKY_CLIENT_ID` / `OPENSKY_CLIENT_SECRET` | — | Optional OpenSky API client (raises the anonymous aviation quota) |
| `AISSTREAM_API_KEY` | — | Optional free key from aisstream.io — global terrestrial AIS for Maritime / SHIP, merged with the keyless feeds (Fintraffic, Kystverket, Open Waters AIS) |
| `AI_PROVIDER` | `local` | `local` = keyless on-device model (no account), `anthropic` = hosted Claude, `none` = off |
| `AI_LOCAL_MODEL` | Gemma 4 E2B Q4_K_M | Override the on-device model (node-llama-cpp URI) |
| `AI_IDLE_UNLOAD_MINUTES` | `5` | Unload the local model after this many idle minutes (reloads on the next AI request); `0` = keep loaded |
| `AI_API_KEY` / `AI_MODEL` | — / `claude-opus-5-5` | Only for `AI_PROVIDER=anthropic` |
| `ANALYST_LOCAL_MODE` | `routed` | AI analyst on the local model: `routed` = the app picks the tools, the model writes; `agent` = the model plans its own tool calls (JSON protocol) |
| `WORLDVIEW_URL` | `http://localhost:3000` | Where the morning-briefing job looks for a running server |
| `MAC_NOTIFY` | `true` | macOS notification when the morning briefing is ready; `false` = off |
| `DISCORD_WEBHOOK_URL` | — | Discord webhook; the morning briefing (AI summary, top developments, markets) posts there as **WorldView**. Test with `npm run discord:test` |
| `DATABASE_URL` | — | Storage: unset = in-memory + JSON snapshot; `pglite` = embedded Postgres (no install); `postgres://…` = PostgreSQL server |

Secrets are read only on the server (`src/lib/env.ts`, guarded by `server-only`) and never sent to the browser.

## Data sources (V1)

| Source | Categories | Refresh | Key |
| --- | --- | --- | --- |
| USGS earthquake feed (M2.5+, 7 days) | Earthquake | 2 min | none |
| EMSC (European-Mediterranean Seismological Centre) | Earthquakes M3+ worldwide, merged with USGS when both report one | 5 min | none |
| Japan Meteorological Agency | Earthquakes in and around Japan with maximum seismic intensity (7 days); volcanic warnings level 2+ | 5 / 30 min | none |
| BMKG (Indonesia) | Latest M5+ and felt earthquakes, with tsunami-potential statement | 5 min | none |
| GeoNet (New Zealand) | Felt earthquakes (MMI 3+, 7 days) | 5 min | none |
| AFAD (Türkiye) | Earthquakes M3+ in and around Türkiye (3 days) | 5 min | none |
| Servicio Sismológico Nacional (Mexico) | Latest located Mexican earthquakes | 5 min | none |
| Hong Kong Observatory | Warnings in force: typhoon signals, rainstorm, flooding, landslip, tsunami… | 10 min | none |
| GDACS (UN/EC disaster alerts) | Earthquake, cyclone, flood, volcano, drought, wildfire | 10 min | none |
| NWS active alerts (severe/extreme, US) | Weather, flood | 5 min | none |
| NOAA National Hurricane Center | Active Atlantic/Pacific hurricanes and tropical storms, per advisory | 15 min | none |
| NOAA Storm Prediction Center | US tornado, damaging-wind and hail reports (last 3 days) | 10 min | none |
| NIFC wildfire incidents | Named US wildfires 100+ acres with size, containment, personnel | 30 min | none |
| Environment Agency flood warnings (England) | Flood alerts, warnings, severe warnings | 15 min | none |
| USGS Volcano Hazards Program | US volcanoes above normal alert level | 30 min | none |
| Copernicus Emergency Management Service | Disasters worldwide with EU satellite rapid mapping (floods, fires, storms…) | 60 min | none |
| NASA EONET open events | Storms, wildfires, volcanoes, ice, … | 20 min | none |
| NASA FIRMS VIIRS (24 h) | Fire (clustered satellite detections) | 30 min | optional |
| GDELT 2.0 event export | Conflict, protest, politics, crime/public safety | 15 min | none |
| GDELT Global Knowledge Graph | News with real headlines: conflict, politics, protests, markets, business, tech, science, health, transport | 15 min | none |
| World news RSS — 42 outlets. Global: BBC, Al Jazeera, NPR, DW, France 24, UN News, Guardian, CNBC, Sky, ABC Australia. Asia: South China Morning Post, Japan Times, The Hindu, Times of India, Dawn, Straits Times, CNA, Yonhap, VnExpress, The Irrawaddy. Middle East: Arab News, Al-Monitor, Haaretz, The National, Middle East Eye. Africa: Africanews, AllAfrica, Premium Times, Daily Maverick, The Africa Report. Latin America: MercoPress, Buenos Aires Times, Mexico News Daily, The Rio Times, Colombia Reports. Europe: Kyiv Independent, Meduza, Balkan Insight, Euronews, RFE/RL. Also CBC and RNZ Pacific | Headlines placed by the place they name (national outlets' own provinces and towns are recognised); the same story from several outlets merges | 15 min | none |
| Environment and Climate Change Canada | Canadian weather warnings with area polygons | 10 min | none |
| NSW Rural Fire Service + VicEmergency | Australian bushfires and official warnings (NSW, Victoria) | 10 min | none |
| MeteoAlarm (EUMETNET) | Orange/red weather warnings from 38 European weather services | 20 min | none |
| Launch Library 2 | Space launches (±7 days) | 30 min | none |
| NOAA tsunami warning centers | Tsunami warnings/advisories/statements | 3 min | none |
| FAA NAS status | US airport ground stops, delays, closures | 5 min | none |
| IODA (Georgia Tech) | National internet outages | 15 min | none |
| NASA JPL fireball data | Bright meteors detected by US government sensors, with impact energy (last 12 months) | 6 h | none |
| Wikipedia Current Events portal | Human-curated daily world events, each linked to the news report it cites | 30 min | none |
| Copernicus CAMS air quality (via Open-Meteo) | Cities of 2M+ with modelled US AQI ≥ 151 (unhealthy or worse) | 60 min | none |
| FDIC failed bank list | US bank failures (last 2 years) | 12 h | none |
| CDC Travelers' Health notices | Outbreaks and health risks by country | 6 h | none |
| US State Department travel advisories | Level 2–4 advisories updated in the last 30 days | 6 h | none |
| UK FCDO foreign travel advice (GOV.UK Content API) | Destinations updated in the last 30 days where the FCDO advises against all / all but essential travel (whole country or parts) | 6 h | none |
| Government of Canada travel advisories | "Avoid non-essential travel" / "Avoid all travel" advisories updated in the last 30 days | 6 h | none |
| Australian Smartraveller | Level 3–4 advice (reconsider your need to travel, do not travel) updated in the last 30 days | 6 h | none |
| Federal Register | US presidential documents (executive orders, proclamations, determinations) | 60 min | none |
| adsb.lol community ADS-B | Aircraft squawking 7700 / 7600 / 7500 right now | 2 min | none |
| WHO Disease Outbreak News | Disease outbreaks (Health) | 60 min | none |
| SEC EDGAR 8-K | Material corporate events at company HQ | 10 min | none |

Live layers (shown in map modes, not stored as events, fetched only while in use):

| Layer | Map mode | Source | Key |
| --- | --- | --- | --- |
| Precipitation radar (past 2 h, animated) | Weather | RainViewer | none |
| Aircraft positions | Aviation | OpenSky Network | none (optional client) |
| Vessel positions (AIS) | Maritime, **SHIP** button | Keyless: Fintraffic Digitraffic (Baltic, CC BY 4.0), Kystverket open AIS (Norway, NLOD; raw NMEA over TCP 153.44.253.27:5631), Open Waters AIS around the view (anonymous tier, ≤10°×10° per request). With a key: AISStream.io (global) merged in | optional `AISSTREAM_API_KEY` |
| Live aircraft | **AIR** button | adsb.lol `/v2/lat/…/lon/…/dist/…` around the view (ODbL), 6° cells cached ~25 s, throttled to adsb.lol's per-IP limit | none |
| Military-flagged aircraft | **MIL** button | adsb.lol `/v2/mil` (ODbL) | none |
| Satellites + orbits | **SAT·ORB** button | CelesTrak GP data, SGP4 in the browser | none |

Details, terms and caveats: [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md).

## Features

- 3D globe with clustering, day/night terminator, three basemaps (dark vector, NASA Blue Marble, night lights)
- **Map modes**: Events, Heatmap, Density grid, Weather (radar loop), Fires (radiative power), Earthquakes (magnitude × depth), Conflict, Aviation (live aircraft), Maritime (live vessels)
- Live feed, event details (facts · sources · timeline · score explanation · related events · separate AI box), country overviews, timeline replay, ⌘K search with intent parsing
- **Place search** (⌘K): type a country, state, city, address, landmark, airport code ("JFK") or coordinates ("48.85, 2.35") and the globe flies there and drops a pin; countries and states open their panels. Instant results from the bundled gazetteer, plus addresses and landmarks from Photon by komoot (OpenStreetMap) via a cached server proxy ([details](docs/DATA_SOURCES.md#place-search-geocoding))
- **Daily briefing** (top-bar "Briefing"): new / developing / ongoing / resolved, today vs yesterday, regional sections, what to watch — every line links to an event; optional AI summary written only from those events. Can be prepared automatically every morning ([below](#morning-briefing))
- **Markets** (top bar): indices, US sectors, Treasury yields + yield curve, FX, commodities, crypto; economic calendar; instrument view with charts, SEC fundamentals and filings; watchlist and in-app price alerts; world events linked to the instruments they could affect; AI market wrap — information only, not advice ([docs/FINANCE.md](docs/FINANCE.md))
- **Analyst** (top bar, AI): ask questions such as "What's driving oil prices today?", "Give me a rundown on NVDA" or "Which world events could affect my watchlist?". The analyst calls the app's own data as tools (events, quotes, history, macro, calendar, CFTC positioning, prediction markets, crypto, Treasury auctions and curve, SEC fundamentals, 10-K analyses, 13F holdings, earnings, IPO filings, trends, energy grids, planet, chokepoints, travel advisories, cyber, country profiles, rule-based event exposure), shows each call live, and answers with numbered citations (source, data time, fetch time) whose actions open the instrument or focus the event on the globe. **Desk note** writes a digest of your watchlist. Information only, not investment advice ([details](docs/ARCHITECTURE.md#analyst))
- **Markets map mode**: countries coloured by their main stock index's daily move
- **Security** (top bar): newly exploited vulnerabilities from CISA's KEV catalog (with ransomware flag and federal due date), critical CVEs published in the last 7 days (NIST NVD), and the latest travel-advisory changes from the US, UK, Canadian and Australian governments. Keyless official sources, cached 1 h ([details](docs/DATA_SOURCES.md#security-panel-srclibcyber))
- **Trends** (top bar): what people are searching and sharing — Google Trends trending searches for 41 countries (plus terms trending in several countries at once, and the selected country's searches in its overview), most-read Wikipedia articles in 12 languages, Bluesky and Mastodon (mastodon.social) trending topics, and the Hacker News front page. Keyless, cached 15 min; aggregate trends and public titles only. Not included: X/Twitter (no free or keyless API; no third-party scrapers) and Reddit (refuses unauthenticated API requests; robots.txt disallows automated access). Trends are attention signals, not verified events ([details](docs/DATA_SOURCES.md#trends-panel-srclibtrends))
- **Energy** (top bar): live electricity grids — demand, generation mix by fuel and renewable share, carbon intensity and wholesale price for Great Britain (NESO Carbon Intensity API, Elexon), Spain (Red Eléctrica), France (RTE éCO2mix), Germany (SMARD) and Australia's NEM (AEMO). Keyless, cached 10 min, all times UTC ([details](docs/DATA_SOURCES.md#energy-panel-srclibenergy))
- **Country profile** in each country overview: population, GDP, GDP per capita, growth, inflation, unemployment, government debt, current account, 3-month rate, 10-year yield and HDI, plus capital, currency and current leaders — each value with its period and source, from the World Bank, IMF, Eurostat, OECD and FRED (keyless official sources), with Wikidata as labelled community data. Cached 24 h ([details](docs/DATA_SOURCES.md#country-profile-srclibcountry-profile))
- Real areas (warning polygons, fire footprints), uncertainty rings by location precision, and location-correction notes
- Source health and live-layer status in Settings → Data sources
- Demo mode with clearly labelled simulated data

## Run it as an always-on local app (macOS)

```bash
npm run build
npm run service:install
```

WorldView then runs as a production server at http://localhost:3000 (bound to this Mac only). It starts when you log in and restarts if it crashes, so feeds keep updating in the background. After pulling changes: `npm run build && npm run service:restart`. Remove it with `npm run service:uninstall`. Log: `.data/server.log`. Don't run `npm run dev` at the same time — both use port 3000 and the same data store.

## Map tools

- **SAT** — satellite view with a source picker:
  - **Best detail (mosaic)**: NASA Blue Marble → 10 m Sentinel-2 (zoom 4+) → sub-metre Esri World Imagery (zoom ~11 to 19; or USGS aerial imagery for the US, or off). Sharp, but a mosaic of past captures — not live.
  - **Live — geostationary**: GOES-East/West GeoColor and Himawari, a new frame every 10 min at ~0.5–2 km per pixel (no coverage over Europe/Africa). It switches to the mosaic as you zoom in.
  - **Daily — VIIRS** and **Night — VIIRS night band**: the last full day's global composite.
  - Optional **roads & labels** (hybrid) and a semi-transparent **clouds (infrared)** overlay that also works on the other map styles.
  - The panel shows what is on screen, its image time ("17:50 UTC, 40 min ago") and whether it is near-real-time or an archive mosaic. Recent imagery re-checks for a new frame every 5 min while the tab is visible. Sources, licences and limits: [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md#map-views).
- **CAM** — ~28,000 public traffic/road-weather cameras from official operator feeds, ~9,500 with live video (Virginia, California, Colorado, South Carolina, Indiana, Iowa, Oklahoma, Missouri, Alabama, Maryland, Delaware), plus stills from London (with MP4 clips), New York City, Washington, Illinois, Kentucky, Kansas, Nebraska, Austin, South Dakota, British Columbia, Toronto, Calgary, Spain, Iceland, Finland, Queensland, Hong Kong and Singapore. Live-video cameras are ringed on the map; the camera key has a "Live video only" toggle. Click to watch the stream or the live image.
- **ISS** — the International Space Station's position (updated every 5 s) and ground track ±90 min (past solid, next 90 min dashed), computed by wheretheiss.at from orbital elements; hover for altitude, speed and day/night.
- **SHIP** — live AIS vessels around the map view in any map mode, coloured by type (cargo, tanker, passenger, fishing, service, pleasure); stationary ones dimmed. Keyless: Fintraffic (Baltic), Kystverket (Norway) and Open Waters AIS cells around the view (worldwide where receivers exist; on very wide views the busiest sea areas are loaded first). With `AISSTREAM_API_KEY`, AISStream's global stream is merged in. **Click a ship** for name, MMSI/IMO, call sign, type, flag (from the MMSI), speed, course, status, destination, ETA, draught, size, a recent trail and links.
- **AIR** — live aircraft around the view (adsb.lol), plane icons rotated by track and coloured by altitude. **Click a plane** for callsign, registration, type, operator, altitude, speed, heading, vertical rate, squawk, registration country (from the ICAO address), a recent trail and adsb.lol / OpenSky links. A **Follow** toggle in the panel keeps the map centred on the selected ship, plane or satellite; Esc closes the panel.
- **MIL** — aircraft broadcasting ADS-B identified as military in the community database (adsb.lol, ODbL), refreshed every 30 s; hover for callsign, type, altitude and speed. Most military flights don't broadcast, so this is a partial view.
- **SAT·ORB** — space stations, operational GPS and the brightest ~150 satellites from CelesTrak elements, positions computed in your browser with SGP4 every 2 s. Click one to draw its orbit (past half orbit and next full orbit).
- **AUR** — NOAA SWPC OVATION aurora forecast: probability of visible aurora (≥ 10 %), with the forecast time in the legend. A model forecast, not an observation.
- **INF** — strategic infrastructure panel: subsea cables and landing points, power plants by fuel, nuclear plants, oil & gas pipelines, LNG terminals, ports, data centres, military bases (OpenStreetMap, WRI Global Power Plant Database, NGA World Port Index — static extracts loaded only when toggled) and 13 maritime chokepoints with a monitor of nearby WorldView events and a disruption score. Sources and licences: [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md#strategic-infrastructure-srclibinfra-npm-run-geoinfra).
- **Zoom in** past continent level and the map switches from countries to states/provinces — hover to highlight, click for that region's events.

## Morning briefing

A once-a-day job refreshes every active source, builds the daily briefing, has the AI (local Gemma 4 by default) write the summary, saves it to `DATA_DIR/briefings/YYYY-MM-DD.json`, unloads the model and exits — nothing stays running. The app shows it as "Morning briefing · <time>".

```bash
npm run briefing:schedule            # daily at 07:30 (macOS)
```

```bash
npm run briefing:schedule -- 6:45    # custom time (24 h, local)
```

```bash
npm run briefing:unschedule
```

This installs a LaunchAgent (`~/Library/LaunchAgents/com.worldview.morning-briefing.plist`). If the Mac is asleep at that time it runs on wake; if it is powered off it doesn't run. Log: `.data/briefings/morning.log`. Run it now with `launchctl kickstart gui/$(id -u)/com.worldview.morning-briefing`, or once in the foreground with `npm run briefing:morning`. On Linux, add a cron line instead: `30 7 * * * cd /path/to/worldinter && npm run briefing:morning`.

If the app server is already running (`WORLDVIEW_URL`), the job uses its API instead of opening the store itself, so two processes never write the same data.

**Mac notification.** When the briefing is ready a macOS notification shows the top headlines (set `MAC_NOTIFY=false` to turn it off). Click into the app's Daily briefing to read the AI summary.

**Discord.** Set `DISCORD_WEBHOOK_URL` (Server Settings → Integrations → Webhooks → New Webhook → Copy URL) and the same briefing, plus key market levels, is posted to that channel under the name **WorldView** — so it's distinguishable from other apps posting there. `npm run discord:test` sends a test message. While the server runs it also posts **🚨 major-event alerts** (new events with importance ≥ `DISCORD_ALERT_MIN_IMPORTANCE`, default 72, linked to their source; at most 4 at a time, never repeated) and a **🔔 market-close wrap** each US trading day after 16:20 New York time (indices, rates, dollar, oil, gold, Bitcoin, top gainers/losers; `DISCORD_MARKET_WRAP=false` to turn off), and after 16:40 a **🔎 stock setups** post: a transparent rule screen over ~80 large caps plus your `SETUP_WATCHLIST` and the day's large-cap losers (pullback in an uptrend, oversold RSI, sharp drop; downtrends and 52-week lows count against). Up to 3 stocks, none repeated within a week, each with an AI note on what stands out, why it might be cheap for a reason, and what to check. It's a screen, not a recommendation. `GET /api/markets/setups` shows the raw scan. Insider buying (SEC Form 4: two or more insiders buying on the open market in 90 days) adds to a setup's score, and each stock's page lists recent insider buys and sells. Every posted pick is logged and scored against the S&P 500 after 1 day, 1 week and 1 month; each Friday a **📊 scorecard** posts the live record next to a backtest of the same rules over ~2 years (`GET /api/markets/setups/scorecard`), including its caveats (survivorship bias, small sample).

**Ask the Analyst what to buy.** "What should I buy?" runs the stock screen and researches the top three itself: why each one moved (Google News headlines, SEC 8-K filings, Nasdaq's earnings calendar), revenue and profit vs a year earlier (SEC XBRL), insider trades (Form 4) and fund ownership (13F). Each gets a take (*Worth a closer look*, *Wait*, *Pass*) from plain rules: an earnings report in the next week means wait; company-specific bad news without growth means pass; a growing business caught in an industry-wide drop is worth a look. The answer is assembled from that research, the AI writes the best-of-the-bunch comparison, and it always ends with the screen's real track record. Ask about one stock ("should I buy VLO?", "research GWRE") for the same research on it.

**Watchlist alerts.** The app syncs your watchlist to the server (`/api/watchlist`). During market hours a **👀 move** alert posts when a watchlist stock is up or down `WATCH_MOVE_PCT`% (default 5, again at 10%), from the server when it's running and from the battery sentinel otherwise; after the close a **📅 earnings** heads-up lists watchlist names reporting the next trading day (Nasdaq's public calendar). The wrap and the scan run from a run-once job (`npm run close:schedule`, weekdays at 16:45 New York time in your local clock; runs on wake if the Mac was asleep) that unloads the AI and exits when done — `npm run close:run` to run it by hand, `npm run close:unschedule` to stop.

**Pages.** A rail on the left switches between full pages: **World** (the globe, sidebar and live feed), **News** (every event as a wide reading list with the story beside it), **Markets**, **Analyst**, **Briefing**, **Planet**, **Energy**, **Security** and **Trends**. The globe is only loaded on the World page, so the others cost no WebGL or map updates. The page you were on is remembered; `?panel=news` (etc.) opens one directly.

**Mac app.** `npm run mac:build` builds **WorldView.app** (a ~140 KB native window using Safari's engine, with its own icon) into `~/Applications`. Opening it starts the server if battery mode stopped it, keeps it awake while the window is open, and lets it stop again after you quit. Links to other sites open in your browser; ⌘R reloads, ⇧⌘O opens the same page in your browser. A **menu bar ticker** shows the S&P 500 (click for indices, rates, oil, gold, Bitcoin, your watchlist and the last 6 hours' major events — each opens in the app), the **Dock badge** counts new major events since you last looked, and **⌘1–⌘9** jump to World, News, Markets, Analyst, Briefing, Planet, Energy, Security and Trends. Closing the window keeps just the menu bar ticker and unloads the page, so on battery the server can still stop. Links like `http://127.0.0.1:3000/?ticker=NVDA`, `?event=<id>` or `?panel=analyst` open straight to that view. Needs the Xcode command line tools.

**On battery the page itself slows down too** (the Mac app reports power; Chrome uses its Battery API): event refreshes stretch from 15 s to 2 min, map overlays (satellites, ISS, aircraft, ships) update 4–7× less often, and when WorldView isn't the app in front they pause entirely, so an idle window costs almost nothing. The on-device AI unloads 2 minutes after its last request.

**Battery mode** (`npm run power:install`). Plugged in, the server runs as usual. On battery it stops once no tab has been open for 10 minutes, and a **sentinel** runs every 15 minutes instead: under a second of CPU to check USGS, GDACS and tsunami feeds plus S&P 500 / VIX during market hours, using the same importance rules. Only when something crosses the bar does it load the AI, write a note, post to Discord and unload it. `npm run app` opens WorldView on battery; `npm run power:uninstall` returns to always-on. Logs: `.data/power.log`, `.data/sentinel.log`.

## How ingestion works

```
connector.fetch()  →  connector.parse()  →  validate (zod)  →  normalise  →  reverse-geocode
   →  upsert by source record  |  deduplicate against nearby events  |  create
   →  status + confidence + importance  →  link related  →  store  →  notify clients (SSE)
```

Each connector runs on its own schedule (respecting upstream limits, with exponential backoff on failure). A failing source never affects the others; its status shows in **Settings → Data sources**. Every run is logged (received/created/updated/deduplicated/errors).

## Adding a data source

1. Create `src/data-sources/<id>/` with `types.ts` (raw upstream types), `client.ts` (fetch), `parser.ts` (pure raw → `EventCandidate[]`) and `index.ts` (the `DataSourceConnector`).
2. Register it in `src/data-sources/registry.ts`.
3. Add a parser test with a small fixture in `tests/connectors.test.ts`.

The full walkthrough is in [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md#adding-a-new-data-source).

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server on http://localhost:3000 (starts ingestion) |
| `npm run build` / `npm start` | Production build / server |
| `npm test` | Unit tests (vitest) |
| `npm run typecheck` | TypeScript check |
| `npm run lint` | ESLint |
| `npm run service:install` / `service:restart` / `service:uninstall` | Always-on production server on localhost:3000 (macOS LaunchAgent; build first) |
| `npm run briefing:morning` | Prepare today's morning briefing once, then exit |
| `npm run briefing:schedule` / `briefing:unschedule` | Install / remove the daily job (macOS LaunchAgent, default 07:30) |
| `npm run geo:build` | Rebuild bundled Natural Earth geography |

## API

| Endpoint | Description |
| --- | --- |
| `GET /api/events` | Filter with `from`, `to`, `type` (comma list), `country`, `importance`, `bbox=w,s,e,n`, `q`, `status`, `sort=recent\|importance`, `limit`, `offset` |
| `GET /api/events/live` | Last 60 minutes |
| `GET /api/events/:id` | Full event (sources, timeline, related). `?raw=1` adds upstream records |
| `POST /api/events/:id/interpret` | Generate AI interpretation (if configured) |
| `GET /api/countries/:code` | Country overview (ISO alpha-2/3) |
| `GET /api/countries/:code/profile` | Country profile: key stats with source and period, capital, currency, leaders (cached 24 h) |
| `GET /api/search?q=` | Places (gazetteer), locations, events, topics + parsed intent. `&ai=1` lets the AI interpret the question into filters |
| `GET /api/geocode?q=` | Online place search (Photon by komoot, OpenStreetMap data); ≥ 3 chars, cached 24 h per query, rate-limited (429) |
| `GET /api/stats` | Aggregates for the same filters as `/api/events` |
| `GET /api/sources` | Source health + recent ingestion runs |
| `POST /api/ingest/:source` | Trigger a run (localhost or `ADMIN_TOKEN`) |
| `GET /api/stream` | Server-Sent Events change notifications |
| `GET /api/briefing` | Daily briefing structure (+ cached AI summary; falls back to today's saved morning summary, flagged in `morning: {date, generatedAt, trigger}`) |
| `POST /api/briefing/narrative` | Generate the AI briefing summary (if configured) |
| `GET /api/markets` | Cross-asset snapshot (cached) |
| `GET /api/markets/quote?symbols=` | Quotes for up to 25 symbols |
| `GET /api/markets/movers` | Last-24 h events with rule-based market exposure |
| `POST /api/markets/summary` | AI market wrap (descriptive, never advice) |
| `GET /api/markets/instrument/:symbol?range=` | Price history + SEC company profile, fundamentals, filings, related events |
| `GET /api/markets/calendar` | Scheduled US economic releases and Treasury auctions |
| `GET /api/markets/yield-curve` | Treasury par yield curve (latest vs a month earlier) |
| `GET /api/markets/reaction?symbols=&since=` | Instrument moves since a time |
| `POST /api/analyst/chat` | AI analyst. Body `{messages: [{role, content}], watchlist?, mode?: "auto"\|"agent"\|"routed"}` → NDJSON stream of `start`, `step`, `tool_result`, `answer_delta`, `answer` (text + citations) or `error`. One run at a time, 12 per client per 10 min (429) |
| `POST /api/analyst/desk-note` | Watchlist digest `{watchlist}` → same NDJSON stream |
| `GET /api/energy` | Live grid demand, generation mix, carbon intensity and prices (GB, ES, FR, DE, AU NEM); cached 10 min |
| `GET /api/geo-audit` | Developer QA of event coordinates |
| `POST /api/ai/setup` | Start downloading/loading the local model |
| `POST /api/ai/unload` | Free the local model's memory (localhost or `ADMIN_TOKEN`) |
| `GET /api/layers` | Live layer status |
| `GET /api/layers/:id` | Cached live layer snapshot (`weather-radar`, `aviation`, `maritime`, `military-aircraft`, `satellites`, …) |
| `GET /api/meta` | Mode and AI availability (no secrets) |

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — system design, layers, extension points
- [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md) — every connector, caveats, how to add one
- [docs/EVENT_MODEL.md](docs/EVENT_MODEL.md) — schema, status rules, importance scoring, deduplication
- [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) — local workflow, testing, demo mode, troubleshooting
- [docs/FINANCE.md](docs/FINANCE.md) — market data sources, exposure rules, caveats

## Attribution

Basemap © [OpenFreeMap](https://openfreemap.org), [OpenMapTiles](https://openmaptiles.org), [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors. Imagery: NASA GIBS. Reference geography: Natural Earth (public domain). Country profiles: World Bank (CC BY 4.0), IMF, Eurostat, OECD, FRED and Wikidata (CC0). Event data © its respective publishers, linked from every event.

## License & credit

WorldView is created by **[akshng](https://github.com/akshng)** and released under the [Apache License 2.0](LICENSE). You're free to use, change and share it, including for school projects. If you redistribute it or build on it, keep the [NOTICE](NOTICE) file and credit the original project, e.g. *"Based on WorldView by akshng"*. GitHub's **Cite this repository** button (from [CITATION.cff](CITATION.cff)) gives a ready-made citation.
