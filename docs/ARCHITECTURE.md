# Architecture

WorldView V1 is a single Next.js 16 application: React client + route-handler API + an in-process ingestion scheduler. Every layer sits behind an interface so it can be split out later (separate ingestion workers, PostgreSQL/PostGIS, a WebSocket gateway, native shells).

```
┌──────────────────────────── Browser (client-only dashboard) ─────────────────────────────┐
│ TopBar · Sidebar · Globe (MapLibre WebGL) · Feed (virtualised) · Panels · Timeline · ⌘K │
│ zustand stores: UI state (persisted prefs) + fetched data; EventSource for live updates  │
└──────────────▲──────────────────────────────────────────────▲──────────────────────────┘
               │ JSON (/api/*)                                │ SSE (/api/stream)
┌──────────────┴──────────────── Next.js route handlers ──────┴──────────────────────────┐
│ events · countries · search · stats · sources · ingest · briefing · interpret · meta    │
└──────────────▲───────────────────────────────────────────────────────────────────────────┘
               │ EventRepository interface
┌──────────────┴────────────┐   ┌─────────────── Ingestion (server context) ──────────────┐
│ MemoryEventRepository     │◀──│ scheduler → connector.fetch → parse → pipeline           │
│  (JSON snapshot, default) │   │ pipeline: validate → normalise → geo → dedupe → score    │
│ PostgresEventRepository   │   │ realtime bus → SSE                                       │
│  (PGlite or PG server)    │   └──────────────────────────────────────────────────────────┘
└───────────────────────────┘   Live layers (src/layers): on-demand cached radar/aircraft/AIS
```

## Directory map

```
src/
  app/                    Next.js routes. page.tsx renders the client-only dashboard.
    api/…                 Route handlers (validated with zod, errors → clean JSON)
  components/
    globe/                MapLibre globe: style (OpenFreeMap + NASA GIBS), layers, terminator
    event-feed/ event-panel/ country-panel/ sidebar/ timeline/ search/ settings/ stats/ layout/ ui/
  data-sources/           One folder per connector (types/client/parser/index) + registry.ts
  lib/
    ai/                   Provider abstraction (Anthropic implementation), optional
    analyst/              AI analyst: typed tools over app data, agent loop, router, citations
    briefing/             Daily briefing structure + saved morning briefings (DATA_DIR/briefings)
    client/               Browser API client, data store, live-data hook
    config/               App naming
    db/                   EventRepository interface, memory implementation, schema.sql
    deduplication/        Similarity scoring + matching
    events/               Build/merge, status/confidence, query/filter, stats
    geo/                  Haversine, polygons, gazetteer (Natural Earth), ocean names
    ingestion/            Pipeline
    realtime/             In-process pub/sub
    scoring/              Importance score
    search/               Location/event/topic search, intent parser
    server/               Process context (repo, scheduler, health), HTTP helpers, analytics
    store/                UI state (zustand)
  data/geo/               Bundled Natural Earth countries/cities (generated)
  types/events.ts         Universal event model (zod schemas + types)
tests/                    vitest suites + fixtures
scripts/                  geo data builder, MapLibre worker copier
docs/
```

## Key decisions

**Two storage implementations behind one interface.** `EventRepository` (`src/lib/db/types.ts`) is implemented by `MemoryEventRepository` (default; 1° grid index, debounced JSON snapshot) and `PostgresEventRepository` (`src/lib/db/postgres/`). The SQL repository runs on a PostgreSQL server via node-postgres or on **embedded PGlite** (Postgres compiled to WASM — zero install), selected by `DATABASE_URL` in `src/lib/db/index.ts`. Events are stored as the validated JSONB document plus indexed columns for every API filter (time, type, country, importance, lat/lon, search text); spatial lookups use an indexed lat/lon box + exact haversine, so PostGIS is optional. Migrations run automatically on start (`src/lib/db/postgres/migrations.ts`). Both implementations pass the same contract suite (`tests/repository.test.ts`). Live and demo data are always stored separately (separate snapshot files / PGlite directories / Postgres schemas).

**Ingestion inside the Next.js process.** The scheduler starts on the first API request (idempotent, stored on `globalThis` so HMR doesn't duplicate it). Per-source intervals, staggered start, exponential backoff, and a "wait out the interval" check against persisted run logs so restarts don't hammer rate-limited APIs (Launch Library 2: 15 req/h). Moving to a worker is a matter of calling `runConnector()` from a separate process.

**Realtime via SSE.** `/api/stream` pushes small change notifications (`events.changed`, `sources.changed`, `event.updated`); clients re-fetch. The bus is an interface (`publish`/`subscribe`) that can be backed by Redis or a WebSocket gateway. The client falls back to polling if the stream drops.

**Client-only dashboard.** The UI depends on the clock, WebGL and per-browser preferences, so it renders on the client (no hydration mismatches). The API remains fully usable by other clients (future iOS/Android/macOS).

**Globe rendering.** MapLibre GL v6 with `projection: globe`. All markers are WebGL layers: clustered GeoJSON source (`clusterProperties.maxImp` colours clusters by their most important event), circle layers sized by importance and faded by age, a heatmap mode, and a country polygon layer for hover/click. Basemap variants (dark vector, Blue Marble, Black Marble) live in one style and toggle by visibility. A solar terminator with twilight bands updates every minute. The MapLibre worker is served from `/public/vendor/maplibre` (copied on install/dev/build) because bundlers rewrite `import.meta.url`.

**Client-side filtering.** The client fetches the timeline span (24 h or 7 d) once and filters by layer/importance/time window locally, so toggles and timeline scrubbing are instant. The feed is virtualised.

## Extension points

| Want to… | Do this |
| --- | --- |
| Add a data source | New folder in `src/data-sources/`, register in `registry.ts` (see DATA_SOURCES.md) |
| Use PostgreSQL | Set `DATABASE_URL=postgres://…` (or `pglite` for embedded) |
| Add PostGIS indexing | Add a `geography` column + GIST index in a new migration; use `ST_DWithin` in `findNear` |
| Add a live layer | `src/layers/<id>/` + registry + map mode (see DATA_SOURCES.md) |
| Add a map mode | Add it to `src/lib/map-modes.ts` (focus categories / live layer), its layers in `components/globe/layers.ts` → `MODE_LAYERS`, and a legend in `Legend.tsx` |
| Change scoring | `src/lib/scoring/importance.ts` (pure, tested, returns explained factors) |
| Improve dedup | `src/lib/deduplication/similarity.ts` — `matchScore` can be replaced by embeddings/AI |
| Natural-language commands | `src/lib/search/intent.ts` returns structured intent; an AI parser can return the same shape |
| AI features | Implement more of `FutureAICapabilities` in `src/lib/ai/` — always writing to interpretation fields |
| Native apps | Consume the same `/api/*` endpoints; the dashboard is a client of the API |

## AI

`src/lib/ai/` defines `AIProvider` with two implementations: **LocalProvider** (default — keyless, on-device Qwen3-4B-Instruct via node-llama-cpp/llama.cpp with Metal; JSON-schema grammar for structured output; requests serialised on one context; model downloaded once to `DATA_DIR/models`; unloaded after `AI_IDLE_UNLOAD_MINUTES` idle and reloaded on the next request) and an Anthropic implementation (official SDK, server-side key, `claude-opus-5-5` by default, server-side refusal fallbacks enabled). Implemented: `interpretEvent` (event panel), `writeBriefing` (briefing summary written only from the briefing's events, cached ≤3 h) and `parseCommand` (search: natural-language question → schema-validated filters via structured outputs; the place *name* is resolved by the app's gazetteer, so the model never supplies coordinates or events). Output is stored in `aiInterpretation` with provider/model/timestamp and rendered in a visually distinct "AI interpretation — not verified fact" box. The prompt instructs the model not to invent facts and to hedge. The planned functions (`summarizeEvent`, `classifyEvent`, `extractLocation`, `extractEntities`, `clusterEvents`, `calculateImportance`, `generate*Briefing`) are declared in `FutureAICapabilities`. AI is disabled for simulated events.

**10-K analysis** (`analyzeFiling`, `src/lib/ai/filing.ts`, `src/lib/finance/filing-analysis.ts`). Pipeline: XBRL company facts → deterministic fiscal-year-vs-prior figures (pure, tested) → if `WORLDVIEW_CONTACT` is set, the 10-K HTML is stripped to text and Items 1 / 1A / 7 / 7A are cut out (headings must start a line; the table of contents is skipped by taking the occurrence with the most text before the next later item) → map-reduce: each provider supplies a plain and a structured completion plus a size budget, long sections are summarised chunk by chunk (local: ~16k-char chunks, notes capped at ~20k chars so the final call fits the 12k-token context), then one structured call (local: JSON-schema grammar; hosted: Zod structured output, usually with whole sections and no map step) returns the six sections. The model only sees the app's pre-formatted figures and the filing's own text; text-derived sections are blanked when no text was read, so the model can't fill them from memory. `POST /api/markets/filing-analysis {ticker, accession}` starts an in-process job (accession must belong to that ticker's annual reports); `GET ?accession=` returns progress steps or the result, which the card polls. AI-complete results are cached at `DATA_DIR/filings/<accession>.json`; a financials-only cache is ignored once a contact is configured.

**Morning briefing.** `scripts/morning-briefing.ts` is a run-once job (scheduled by `scripts/schedule-briefing.mjs` as a macOS LaunchAgent): refresh all active sources → `buildDailyBriefing` → `writeBriefing` → save `DATA_DIR/briefings/YYYY-MM-DD.json` → unload the model → exit. If a server is reachable at `WORLDVIEW_URL` it goes through `POST /api/briefing/narrative`, `GET /api/briefing` and `POST /api/ai/unload` instead, so only one process ever writes the store. `GET /api/briefing` falls back to today's saved narrative and reports it in a `morning` field. It then shows a macOS notification with the top headlines (`src/lib/notify/mac.ts`, `osascript` with title/text passed as arguments, never spliced into the script; `MAC_NOTIFY=false` disables it), and, if `DISCORD_WEBHOOK_URL` is set, posts embeds to Discord as "WorldView" (`src/lib/notify/discord.ts`; mentions disabled, clipped to Discord limits).

## Analyst

An AI research assistant (top bar → **Analyst**) that answers questions from the app's own data, with citations. Code in `src/lib/analyst/`; UI in `src/components/analyst/AnalystPanel.tsx`.

```
question ─▶ runAnalyst (agent.ts) ─▶ tools.ts (30 typed tools, ToolDeps) ─▶ existing server modules
               │  native: Anthropic tool use          (repository, finance/*, trends, energy, planet,
               │  agent:  local JSON protocol           infra, cyber, country-profile, exposure rules)
               │  routed: router.ts picks the tools
               ▼
   size-capped results (cap.ts) ─▶ model writes ─▶ finalizeAnswer (citations.ts) ─▶ NDJSON stream
```

- **Tools** (`tools.ts`): `search_events`, `get_event`, `events_near`, `exposure` (rule-based event → instrument links; per event with the move since the event, or today's events optionally filtered to a watchlist), `get_quote`, `price_history`, `market_snapshot`, `movers`, `find_instrument`, `macro_indicators`, `economic_calendar`, `cftc_positioning`, `prediction_markets`, `crypto_markets`, `treasury_auctions`, `yield_curve`, `futures_curves`, `company_profile`, `annual_report_analysis` (cached 10-K analysis; starts one only when the user explicitly asks), `fund_holdings`, `held_by`, `earnings_releases`, `ipo_filings`, `trends`, `energy_grids`, `planet`, `chokepoints`, `travel_advisories`, `cyber`, `country_profile`. Each has a small parameter spec (one source for the hosted JSON schema, the local grammar and argument validation) and calls server modules directly through `ToolDeps` (`deps.ts`; tests inject mocks). A tool returns compact JSON plus citation metadata: source label, the latest upstream timestamp, links and in-app actions (open instrument, focus event, open country). Ticker searches match whole words and the SEC company name (the repository's substring search would match "nvda" inside "nvdaily.com"). Signs that a small model could flip (CFTC net positions) are spelled out in words.
- **Loop** (`agent.ts`): at most **6 tool executions** per answer, 45 s per tool. *Native* (Anthropic, `claude-opus-5-5`, effort medium, server-side refusal fallback): manual tool-use loop, assistant content (incl. thinking blocks) replayed unchanged; when the budget is spent the last turn runs with `tool_choice: none`. *Agent* (local): one `LlamaChatSession` per run (KV cache reused between steps); each planning step is grammar-constrained to `{"calls":[{"tool","args"}]}` (≤ 3 per step, ≤ 3 rounds, empty list = done; `protocol.ts` also tolerates fences / shape variants and validates each call); results go back in the same session, then a free-text writing prompt streams the answer. If the first plan is empty it falls back to routing. *Routed*: `router.ts` maps keywords and entities (tickers, `$TICKER`, well-known company names, gazetteer countries, topics such as oil / rates / crypto / shipping, "my watchlist") to ≤ 6 calls; the model only writes the summary from all results in one prompt. Tool output is capped deterministically (`capJson`: arrays and strings shrink until the JSON fits; local ≤ 1.8–2.6k chars per result, hosted 12k).
- **Rules** (`prompts.ts`): facts only from tool results, cite `[S#]` markers, say when data is missing or delayed, separate *Facts* from *Interpretation* and *What to watch*, no personalised advice or buy/sell instructions, simulated events flagged, end with "Information only, not investment advice." `finalizeAnswer` removes markers that match no source and any source list the model wrote, then appends the app's own list (`[S1] get_quote(NVDA) — Yahoo Finance (unofficial, delayed); data as of …, fetched …`) and the disclaimer, so every answer states what it was built from.
- **API** (`src/app/api/analyst/*`, `server.ts`): `POST /api/analyst/chat {messages, watchlist, mode}` and `POST /api/analyst/desk-note {watchlist}` (the watchlist lives in client settings; the note uses a fixed plan: watchlist quotes, snapshot, events exposed to the watchlist, news on the first ticker, earnings releases, the next 5 days' releases). Responses are NDJSON (`start` with provider/model/mode, `status`, `step`, `tool_result` with the citation, `answer_delta`, `answer`, `error`). Runs are serialised (one at a time, ≤ 2 waiting, else 429) and rate-limited (12 per client per 10 min); the local model's own queue serialises further.
- **Local model choice.** On Qwen3-4B, grammar-constrained planning always yields valid calls and usually sensible tools, but it under-gathers (often 1–3 tools), costs an extra 10–20 s per planning round and once tried to start a 10-K job (now gated). Routed mode answers in ~30–80 s with more relevant data, so it is the default (`ANALYST_LOCAL_MODE=routed`); `agent` can be selected per request (`mode`) or by env. The 4B model still makes occasional reasoning slips (wrong sign, mislabelled quarter, loose causal links), which is why every fact carries a marker the user can check against the source list.

## Security

- Secrets only in server env; `server-only` guards modules that read them; `/api/meta` exposes no secrets.
- All API input validated with zod; unknown params ignored; errors return JSON without stack traces.
- Upstream text is stripped of HTML (`plainText`) and rendered as React text — no `dangerouslySetInnerHTML` anywhere. Map popups use `setDOMContent` with `textContent`.
- Only `http(s)` URLs are stored (schema-enforced) and links open with `rel="noopener noreferrer nofollow"`.
- Manual ingestion and `POST /api/ai/unload` are restricted to localhost or `ADMIN_TOKEN`.
