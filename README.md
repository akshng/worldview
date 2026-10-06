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

AI features (event interpretation, briefing summary, natural-language search) run **on your computer** by default: an open-weights model (Qwen3-4B-Instruct-2507, Apache-2.0) via llama.cpp (Metal on Apple Silicon). No account, no API key, nothing leaves the machine. The model (≈2.5 GB) downloads once from Hugging Face on first use, or ahead of time:

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
| `AISSTREAM_API_KEY` | — | Free key from aisstream.io — required for the Maritime map mode |
| `AI_PROVIDER` | `local` | `local` = keyless on-device model (no account), `anthropic` = hosted Claude, `none` = off |
| `AI_LOCAL_MODEL` | Qwen3-4B-Instruct Q4_K_M | Override the on-device model (node-llama-cpp URI) |
| `AI_IDLE_UNLOAD_MINUTES` | `5` | Unload the local model after this many idle minutes (reloads on the next AI request); `0` = keep loaded |
| `AI_API_KEY` / `AI_MODEL` | — / `claude-opus-5-5` | Only for `AI_PROVIDER=anthropic` |
| `WORLDVIEW_URL` | `http://localhost:3000` | Where the morning-briefing job looks for a running server |
| `MAC_NOTIFY` | `true` | macOS notification when the morning briefing is ready; `false` = off |
| `DATABASE_URL` | — | Storage: unset = in-memory + JSON snapshot; `pglite` = embedded Postgres (no install); `postgres://…` = PostgreSQL server |

Secrets are read only on the server (`src/lib/env.ts`, guarded by `server-only`) and never sent to the browser.

## Data sources (V1)

| Source | Categories | Refresh | Key |
| --- | --- | --- | --- |
| USGS earthquake feed (M2.5+, 7 days) | Earthquake | 2 min | none |
| EMSC (European-Mediterranean Seismological Centre) | Earthquakes M3+ worldwide, merged with USGS when both report one | 5 min | none |
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
| World news RSS (BBC, Al Jazeera, NPR, DW, France 24, UN News, Guardian, CNBC, Sky, ABC Australia) | Headlines placed by the place they name; the same story from several outlets merges | 15 min | none |
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
| Federal Register | US presidential documents (executive orders, proclamations, determinations) | 60 min | none |
| adsb.lol community ADS-B | Aircraft squawking 7700 / 7600 / 7500 right now | 2 min | none |
| WHO Disease Outbreak News | Disease outbreaks (Health) | 60 min | none |
| SEC EDGAR 8-K | Material corporate events at company HQ | 10 min | none |

Live layers (shown in map modes, not stored as events, fetched only while in use):

| Layer | Map mode | Source | Key |
| --- | --- | --- | --- |
| Precipitation radar (past 2 h, animated) | Weather | RainViewer | none |
| Aircraft positions | Aviation | OpenSky Network | none (optional client) |
| Vessel positions (AIS) | Maritime | AISStream.io | `AISSTREAM_API_KEY` |

Details, terms and caveats: [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md).

## Features

- 3D globe with clustering, day/night terminator, three basemaps (dark vector, NASA Blue Marble, night lights)
- **Map modes**: Events, Heatmap, Density grid, Weather (radar loop), Fires (radiative power), Earthquakes (magnitude × depth), Conflict, Aviation (live aircraft), Maritime (live vessels)
- Live feed, event details (facts · sources · timeline · score explanation · related events · separate AI box), country overviews, timeline replay, ⌘K search with intent parsing
- **Daily briefing** (top-bar "Briefing"): new / developing / ongoing / resolved, today vs yesterday, regional sections, what to watch — every line links to an event; optional AI summary written only from those events. Can be prepared automatically every morning ([below](#morning-briefing))
- **Markets** (top bar): indices, US sectors, Treasury yields + yield curve, FX, commodities, crypto; economic calendar; instrument view with charts, SEC fundamentals and filings; watchlist and in-app price alerts; world events linked to the instruments they could affect; AI market wrap — information only, not advice ([docs/FINANCE.md](docs/FINANCE.md))
- **Markets map mode**: countries coloured by their main stock index's daily move
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

- **SAT** — satellite view (NASA Blue Marble, then 10 m Sentinel-2 imagery when zoomed in).
- **CAM** — ~7,000 public traffic/road-weather cameras (London, New York City, California, Hong Kong, Finland, Singapore); click for the live image or video.
- **Zoom in** past continent level and the map switches from countries to states/provinces — hover to highlight, click for that region's events.

## Morning briefing

A once-a-day job refreshes every active source, builds the daily briefing, has the AI (local Qwen by default) write the summary, saves it to `DATA_DIR/briefings/YYYY-MM-DD.json`, unloads the model and exits — nothing stays running. The app shows it as "Morning briefing · <time>".

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
| `GET /api/search?q=` | Locations, events, topics + parsed intent. `&ai=1` lets the AI interpret the question into filters |
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
| `GET /api/geo-audit` | Developer QA of event coordinates |
| `POST /api/ai/setup` | Start downloading/loading the local model |
| `POST /api/ai/unload` | Free the local model's memory (localhost or `ADMIN_TOKEN`) |
| `GET /api/layers` | Live layer status |
| `GET /api/layers/:id` | Cached live layer snapshot (`weather-radar`, `aviation`, `maritime`) |
| `GET /api/meta` | Mode and AI availability (no secrets) |

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — system design, layers, extension points
- [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md) — every connector, caveats, how to add one
- [docs/EVENT_MODEL.md](docs/EVENT_MODEL.md) — schema, status rules, importance scoring, deduplication
- [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) — local workflow, testing, demo mode, troubleshooting
- [docs/FINANCE.md](docs/FINANCE.md) — market data sources, exposure rules, caveats

## Attribution

Basemap © [OpenFreeMap](https://openfreemap.org), [OpenMapTiles](https://openmaptiles.org), [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors. Imagery: NASA GIBS. Reference geography: Natural Earth (public domain). Event data © its respective publishers, linked from every event.

## License & credit

WorldView is created by **[akshng](https://github.com/akshng)** and released under the [Apache License 2.0](LICENSE). You're free to use, change and share it, including for school projects. If you redistribute it or build on it, keep the [NOTICE](NOTICE) file and credit the original project, e.g. *"Based on WorldView by akshng"*. GitHub's **Cite this repository** button (from [CITATION.cff](CITATION.cff)) gives a ready-made citation.
